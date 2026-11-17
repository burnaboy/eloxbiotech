"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma, type AdminPermission } from "@prisma/client";
import { z } from "zod";
import { canSeeCosts, hasRecentStepUp, requireAdmin, requireSuperAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { runAction, str, type ActionState } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { optionalMinor, percentToBps, signedMinor, toMinor } from "@/lib/money";
import { publishPlan } from "@/lib/comp-plan";
import { normaliseCode } from "@/lib/discounts";
import { cancelPendingOrder, updateFulfilment } from "@/lib/orders";
import { refundExtraPayment, refundOrder, retryRefund } from "@/lib/refunds";
import { matureOrders, runBinary, setCommissionHold } from "@/lib/commissions";
import { adjustWallet, createPayoutBatch, failPayout, requeuePayout, reviewPayout, settlePayout } from "@/lib/wallet";
import { resolveReturn } from "@/lib/returns";
import { closeTicket, replyTicket } from "@/lib/support";
import { resetMfa } from "@/lib/mfa";
import { notify } from "@/lib/notify";
import { productFormSchema, variantFormSchema, cmToMm, lagosLocalToDate, type ProductFormValues } from "@/lib/product-input";
import { parseAttributes, refreshListPrice } from "@/lib/catalog";
import { adjustStock, receiveReturnedItems } from "@/lib/inventory";
import { addProductImage, moveProductImage, removeProductImage } from "@/lib/images";
import { placeInTree } from "@/lib/tree";
import { reconcileVolume } from "@/lib/volume";
import { reconcileLedger } from "@/lib/ledger";
import { verifyAuditChain } from "@/lib/audit";
import {
  brandSchema, compPlanSchema, getBrand, getOps, getShopSettings, opsSchema, saveSetting, shopSettingsSchema,
} from "@/lib/settings";

/**
 * `risk` marks a high-risk action: the form must carry a reason (5+ characters, kept in the audit log)
 * and, when `confirm` is set, that word typed out. Both are checked here on the server.
 */
type Guard = { perm?: AdminPermission; superOnly?: boolean; stepUp?: boolean; risk?: { fd: FormData; action: string; target?: string | null; confirm?: string } };

function riskReason(risk: NonNullable<Guard["risk"]>) {
  const reason = str(risk.fd, "reason").trim();
  if (reason.length < 5) throw new AppError("Give a reason for this action (at least 5 characters). It's kept in the audit log.");
  if (reason.length > 300) throw new AppError("Keep the reason under 300 characters.");
  if (risk.confirm && str(risk.fd, "confirm").trim().toUpperCase() !== risk.confirm) throw new AppError(`Type ${risk.confirm} to confirm.`);
  return reason;
}

/**
 * Every admin mutation goes through here: authorisation is checked on the server for each call,
 * sensitive ones also need a recent authenticator code. Returns to `path` with a message.
 */
async function act(path: string, guard: Guard, fn: (adminId: string, reason: string | null) => Promise<string | void>) {
  const admin = guard.superOnly ? await requireSuperAdmin() : await requireAdmin(guard.perm);
  if (guard.stepUp && !(await hasRecentStepUp())) {
    redirect(`/admin/verify?next=${encodeURIComponent(path)}`);
  }
  const res = await runAction(async () => {
    const reason = guard.risk ? riskReason(guard.risk) : null;
    const ok = await fn(admin.id, reason);
    if (guard.risk) await audit("admin.highRisk", "AdminAction", guard.risk.target ?? null, admin.id, { action: guard.risk.action, reason, privileged: true });
    return ok ? { ok } : null;
  });
  revalidatePath(path);
  const sep = path.includes("?") ? "&" : "?";
  const q = res?.error ? `${sep}error=${encodeURIComponent(res.error)}` : res?.ok ? `${sep}ok=${encodeURIComponent(res.ok)}` : "";
  redirect(`${path}${q}`);
}

const num = (fd: FormData, k: string) => Number(str(fd, k));

// ---------- Products, categories, testimonials ----------

/** Creates or updates a product. Cost price is only read or written for staff with PRODUCT_COSTS. */
export async function saveProductAction(id: string | null, raw: ProductFormValues): Promise<ActionState> {
  const admin = await requireAdmin("PRODUCTS");
  const costs = canSeeCosts(admin);
  let savedId = id;
  const res = await runAction(async () => {
    const v = productFormSchema.parse(raw);
    const data = {
      name: v.name, slug: v.slug, sku: v.sku, description: v.description, categoryId: v.categoryId || null,
      status: v.status, featured: v.featured,
      priceMinor: toMinor(v.price), salePriceMinor: optionalMinor(v.salePrice),
      saleStartsAt: lagosLocalToDate(v.saleStartsAt), saleEndsAt: lagosLocalToDate(v.saleEndsAt),
      pv: Number(v.pv), lowStockThreshold: Number(v.lowStockThreshold),
      shippable: v.shippable, weightGrams: v.weightGrams ? Number(v.weightGrams) : 0,
      lengthMm: cmToMm(v.lengthCm), widthMm: cmToMm(v.widthCm), heightMm: cmToMm(v.heightCm),
      metaTitle: v.metaTitle || null, metaDescription: v.metaDescription || null,
      attributes: parseAttributes(v.attributes),
      ...(costs && v.costPrice !== undefined ? { costPriceMinor: optionalMinor(v.costPrice) } : {}),
    };
    if (data.categoryId && !(await prisma.category.findUnique({ where: { id: data.categoryId } }))) throw new AppError("That category doesn't exist.");
    try {
      await prisma.$transaction(async (tx) => {
        if (id) {
          const before = await tx.product.findUniqueOrThrow({ where: { id }, omit: { costPriceMinor: !costs } });
          await tx.product.update({ where: { id }, data });
          await refreshListPrice(tx, id);
          await audit("product.update", "Product", id, admin.id, { before: pick(before), after: pick(data) } as Prisma.InputJsonObject, tx);
        } else {
          const p = await tx.product.create({ data: { ...data, listPriceMinor: data.priceMinor } });
          await refreshListPrice(tx, p.id);
          const stock = v.initialStock ? Number(v.initialStock) : 0;
          if (stock > 0) {
            await tx.product.update({ where: { id: p.id }, data: { stock } });
            await tx.inventoryMovement.create({ data: { productId: p.id, delta: stock, balance: stock, reason: "RESTOCK", actorId: admin.id, note: "Opening stock" } });
          }
          await audit("product.create", "Product", p.id, admin.id, pick(data) as Prisma.InputJsonObject, tx);
          savedId = p.id;
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new AppError("That SKU or URL slug is already used.");
      throw e;
    }
  });
  if (res) return res;
  revalidatePath("/admin/products");
  redirect(`/admin/products/${savedId}?ok=Saved`);
}

/** Fields worth keeping in the audit trail for a product change. */
function pick(p: Record<string, unknown>) {
  const keys = ["name", "sku", "slug", "status", "priceMinor", "salePriceMinor", "saleStartsAt", "saleEndsAt", "costPriceMinor", "pv", "shippable", "categoryId", "lowStockThreshold"];
  return Object.fromEntries(keys.filter((k) => k in p).map((k) => [k, p[k] instanceof Date ? (p[k] as Date).toISOString() : (p[k] ?? null)]));
}

export async function saveVariantAction(productId: string, variantId: string | null, fd: FormData) {
  await act(`/admin/products/${productId}`, { perm: "PRODUCTS" }, async (adminId) => {
    const admin = await requireAdmin("PRODUCTS");
    const costs = canSeeCosts(admin);
    const v = variantFormSchema.parse({
      name: str(fd, "name"), sku: str(fd, "sku"), options: str(fd, "options"), price: str(fd, "price"), salePrice: str(fd, "salePrice"),
      costPrice: costs ? str(fd, "costPrice") : undefined, pv: str(fd, "pv"), weightGrams: str(fd, "weightGrams"),
      lowStockThreshold: str(fd, "lowStockThreshold"), sortOrder: str(fd, "sortOrder") || "0", active: fd.get("active") === "on",
      initialStock: variantId ? undefined : str(fd, "initialStock") || "0",
    });
    const data = {
      name: v.name, sku: v.sku, options: parseAttributes(v.options.replace(/,\s*/g, "\n")),
      priceMinor: optionalMinor(v.price), salePriceMinor: optionalMinor(v.salePrice),
      pv: v.pv ? Number(v.pv) : null, weightGrams: v.weightGrams ? Number(v.weightGrams) : null,
      lowStockThreshold: v.lowStockThreshold ? Number(v.lowStockThreshold) : null, sortOrder: Number(v.sortOrder || 0), active: v.active,
      ...(costs && v.costPrice !== undefined ? { costPriceMinor: optionalMinor(v.costPrice) } : {}),
    };
    try {
      await prisma.$transaction(async (tx) => {
        const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
        const regular = data.priceMinor ?? product.priceMinor;
        if (data.salePriceMinor !== null && data.salePriceMinor >= regular) throw new AppError("Sale price must be below the option's regular price.");
        if (variantId) {
          await tx.productVariant.update({ where: { id: variantId, productId }, data });
          await audit("variant.update", "Product", productId, adminId, { variantId, ...pick(data) } as Prisma.InputJsonObject, tx);
        } else {
          const isFirst = (await tx.productVariant.count({ where: { productId } })) === 0;
          if (isFirst && product.stock > 0) throw new AppError(`This product has ${product.stock} unit(s) of stock without options. Move them to zero with an adjustment first, then add options and stock each one.`);
          const created = await tx.productVariant.create({ data: { ...data, productId } });
          const stock = v.initialStock ? Number(v.initialStock) : 0;
          if (stock > 0) {
            await tx.productVariant.update({ where: { id: created.id }, data: { stock } });
            await tx.inventoryMovement.create({ data: { productId, variantId: created.id, delta: stock, balance: stock, reason: "RESTOCK", actorId: adminId, note: "Opening stock" } });
          }
          await audit("variant.create", "Product", productId, adminId, { variantId: created.id, ...pick(data) } as Prisma.InputJsonObject, tx);
        }
        await refreshListPrice(tx, productId);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new AppError("That option SKU is already used.");
      throw e;
    }
    return "Option saved";
  });
}

export async function adjustStockAction(productId: string, fd: FormData) {
  await act(`/admin/products/${productId}`, { perm: "PRODUCTS" }, async (adminId) => {
    const variantId = str(fd, "variantId") || null;
    const delta = z.string().trim().regex(/^[+-]?\d{1,7}$/, "Enter a whole number like +10 or -2").parse(str(fd, "delta"));
    const balance = await adjustStock({
      productId, variantId, delta: Number(delta), reason: z.enum(["RESTOCK", "ADJUSTMENT"]).parse(str(fd, "reason")), note: str(fd, "note"), actorId: adminId,
    });
    return `Stock updated. Now ${balance}.`;
  });
}

export async function uploadImageAction(productId: string, fd: FormData) {
  await act(`/admin/products/${productId}`, { perm: "PRODUCTS" }, async (adminId) => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("Choose an image to upload.");
    await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { id: true } });
    await addProductImage(productId, file, str(fd, "alt"), adminId);
    return "Image uploaded";
  });
}

export async function imageAction(productId: string, imageId: string, op: "up" | "down" | "remove") {
  await act(`/admin/products/${productId}`, { perm: "PRODUCTS" }, async (adminId) => {
    const img = await prisma.productImage.findFirst({ where: { id: imageId, productId } });
    if (!img) throw new AppError("Image not found.");
    if (op === "remove") await removeProductImage(imageId, adminId);
    else {
      await moveProductImage(imageId, op === "up" ? -1 : 1);
      await audit("product.imageMove", "Product", productId, adminId, { imageId, direction: op });
    }
    return op === "remove" ? "Image removed" : "Order updated";
  });
}

export async function receiveReturnAction(orderId: string, fd: FormData) {
  await act(`/admin/orders/${orderId}`, { perm: "ORDERS" }, async (adminId) => {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    const lines = order.items.map((i) => ({
      orderItemId: i.id,
      restock: Number(z.string().regex(/^\d{0,4}$/).parse(str(fd, `restock_${i.id}`)) || 0),
      writeOff: Number(z.string().regex(/^\d{0,4}$/).parse(str(fd, `writeoff_${i.id}`)) || 0),
    }));
    await receiveReturnedItems(orderId, lines, adminId, str(fd, "note").slice(0, 300) || undefined);
    return "Returned goods recorded";
  });
}

export async function saveCategoryAction(id: string | null, fd: FormData) {
  await act(`/admin/categories`, { perm: "PRODUCTS" }, async (adminId) => {
    const v = z
      .object({
        name: z.string().trim().min(2).max(60), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).max(60), description: z.string().trim().max(300),
        sortOrder: z.coerce.number().int().min(-9999).max(9999), active: z.boolean(), parentId: z.string().max(40).transform((s) => s || null),
      })
      .parse({ name: str(fd, "name"), slug: str(fd, "slug"), description: str(fd, "description"), sortOrder: str(fd, "sortOrder") || "0", active: fd.get("active") === "on", parentId: str(fd, "parentId") });
    if (v.parentId) {
      if (v.parentId === id) throw new AppError("A category can't be inside itself.");
      const parent = await prisma.category.findUnique({ where: { id: v.parentId } });
      if (!parent || parent.parentId) throw new AppError("Choose a top-level category as the parent.");
      if (id && (await prisma.category.count({ where: { parentId: id } })) > 0) throw new AppError("This category has subcategories, so it must stay top level.");
    }
    try {
      const c = id ? await prisma.category.update({ where: { id }, data: v }) : await prisma.category.create({ data: v });
      await audit(id ? "category.update" : "category.create", "Category", c.id, adminId, v);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new AppError("That slug is already used.");
      throw e;
    }
    return "Category saved";
  });
}

export async function saveTestimonialAction(id: string | null, fd: FormData) {
  await act(`/admin/testimonials`, { perm: "PRODUCTS" }, async (adminId) => {
    const v = z
      .object({ name: z.string().trim().min(2).max(80), location: z.string().trim().max(80), quote: z.string().trim().min(10).max(600), consentConfirmed: z.boolean(), published: z.boolean() })
      .parse({ name: str(fd, "name"), location: str(fd, "location"), quote: str(fd, "quote"), consentConfirmed: fd.get("consentConfirmed") === "on", published: fd.get("published") === "on" });
    if (v.published && !v.consentConfirmed) throw new AppError("Confirm the customer gave written consent before publishing.");
    const t = id ? await prisma.testimonial.update({ where: { id }, data: { ...v, location: v.location || null } }) : await prisma.testimonial.create({ data: { ...v, location: v.location || null } });
    await audit("testimonial.save", "Testimonial", t.id, adminId, v);
    return "Testimonial saved";
  });
}

export async function deleteTestimonialAction(id: string) {
  await act(`/admin/testimonials`, { perm: "PRODUCTS" }, async (adminId) => {
    await prisma.testimonial.delete({ where: { id } });
    await audit("testimonial.delete", "Testimonial", id, adminId);
    return "Deleted";
  });
}

// ---------- Orders and returns ----------

export async function shipOrderAction(orderId: string, fd: FormData) {
  await act(`/admin/orders/${orderId}`, { perm: "ORDERS" }, async (adminId) => {
    await updateFulfilment(orderId, "SHIPPED", adminId, { carrier: str(fd, "carrier").trim().slice(0, 60), trackingRef: str(fd, "trackingRef").trim().slice(0, 100) });
    return "Marked as shipped";
  });
}
export async function deliverOrderAction(orderId: string) {
  await act(`/admin/orders/${orderId}`, { perm: "ORDERS" }, async (adminId) => {
    await updateFulfilment(orderId, "DELIVERED", adminId);
    return "Marked as delivered";
  });
}
export async function processingOrderAction(orderId: string) {
  await act(`/admin/orders/${orderId}`, { perm: "ORDERS" }, async (adminId) => {
    await updateFulfilment(orderId, "PROCESSING", adminId);
    return "Order marked as being prepared";
  });
}

/** Full refund, or chosen units plus optionally the delivery charge. Amounts are always worked out on the server. */
export async function refundOrderAction(orderId: string, fd: FormData) {
  await act(`/admin/orders/${orderId}`, { perm: "ORDERS", stepUp: true }, async (adminId) => {
    if (str(fd, "confirm") !== "REFUND") throw new AppError("Type REFUND to confirm.");
    const full = str(fd, "scope") === "full";
    let lines: { orderItemId: string; quantity: number }[] | undefined;
    if (!full) {
      const items = await prisma.orderItem.findMany({ where: { orderId }, select: { id: true } });
      lines = items.map((i) => ({ orderItemId: i.id, quantity: Number(z.string().regex(/^\d{0,3}$/, "Quantities must be whole numbers").parse(str(fd, `qty_${i.id}`)) || 0) })).filter((l) => l.quantity > 0);
    }
    const r = await refundOrder(orderId, adminId, { reason: str(fd, "reason").slice(0, 300), lines, shipping: fd.get("shipping") === "on" });
    if (r.status === "FAILED") return `Refund recorded but the payment provider refused it: ${r.failureReason}. Retry it below.`;
    if (r.status === "PENDING") return r.failureReason ? "Refund recorded. The payment provider didn't confirm it yet; check the provider dashboard before retrying." : "Refund sent to the payment provider. It will show as processed when they confirm.";
    return "Refund processed";
  });
}

export async function retryRefundAction(orderId: string, refundId: string, fd: FormData) {
  await act(`/admin/orders/${orderId}`, { perm: "ORDERS", stepUp: true, risk: { fd, action: "refund.retry", target: refundId } }, async (adminId) => {
    const r = await retryRefund(refundId, adminId);
    return r.status === "FAILED" ? `The payment provider refused it again: ${r.failureReason}` : "Refund sent again";
  });
}

export async function refundExtraPaymentAction(orderId: string, paymentId: string, fd: FormData) {
  await act(`/admin/orders/${orderId}`, { perm: "ORDERS", stepUp: true, risk: { fd, action: "payment.refundExtra", target: paymentId, confirm: "REFUND" } }, async (adminId, reason) => {
    const r = await refundExtraPayment(paymentId, adminId, reason ?? "Extra payment returned");
    return r.status === "FAILED" ? `The payment provider refused it: ${r.failureReason}` : "Extra payment is being returned";
  });
}
export async function cancelOrderAdminAction(orderId: string, fd: FormData) {
  await act(`/admin/orders/${orderId}`, { perm: "ORDERS", risk: { fd, action: "order.cancel", target: orderId, confirm: "CANCEL" } }, async (adminId) => {
    await cancelPendingOrder(orderId, adminId);
    return "Order cancelled and stock released";
  });
}
export async function resolveReturnAction(id: string, action: "APPROVE" | "REFUND" | "REJECT", fd: FormData) {
  await act(`/admin/returns`, { perm: "ORDERS", stepUp: action === "REFUND" }, async (adminId) => {
    await resolveReturn(id, action, adminId, { note: str(fd, "note").trim().slice(0, 500) });
    return `Return ${action === "REFUND" ? "refunded" : action === "APPROVE" ? "approved" : "rejected"}`;
  });
}

// ---------- Members ----------

export async function setUserStatusAction(userId: string, status: "ACTIVE" | "SUSPENDED", fd: FormData) {
  await act(`/admin/users/${userId}`, { perm: "MEMBERS", risk: { fd, action: status === "SUSPENDED" ? "user.suspended" : "user.active", target: userId, confirm: status === "SUSPENDED" ? "SUSPEND" : undefined } }, async (adminId, reason) => {
    z.enum(["ACTIVE", "SUSPENDED"]).parse(status);
    if (userId === adminId) throw new AppError("You can't change your own status.");
    const target = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (target.role === "SUPER_ADMIN") throw new AppError("Super administrators can't be suspended here.");
    await prisma.user.update({ where: { id: userId }, data: { status } });
    if (status === "SUSPENDED") await prisma.session.deleteMany({ where: { userId } });
    await audit(`user.${status.toLowerCase()}`, "User", userId, adminId, { reason });
    return status === "SUSPENDED" ? "Member suspended and signed out" : "Member reactivated";
  });
}

export async function revokeSessionsAction(userId: string, fd: FormData) {
  await act(`/admin/users/${userId}`, { perm: "MEMBERS", risk: { fd, action: "user.revokeSessions", target: userId } }, async (adminId, reason) => {
    const r = await prisma.session.deleteMany({ where: { userId } });
    await audit("user.revokeSessions", "User", userId, adminId, { count: r.count, reason });
    return `Signed out of ${r.count} session(s)`;
  });
}

// ---------- Commissions ----------

export async function matureNowAction() {
  await act(`/admin/commissions`, { perm: "COMMISSIONS" }, async (adminId) => {
    const n = await matureOrders();
    await audit("commission.matureNow", "Commission", null, adminId, { orders: n, privileged: true });
    return `${n} order(s) approved`;
  });
}

export async function runBinaryAction(fd: FormData) {
  await act(`/admin/commissions`, { perm: "COMMISSIONS", stepUp: true, risk: { fd, action: "binary.run", target: str(fd, "period"), confirm: "RUN" } }, async (adminId) => {
    const period = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date").parse(str(fd, "period"));
    const r = await runBinary(period, adminId);
    return `Binary for ${period}: ${r.pairsPaid} pairs paid`;
  });
}

export async function holdCommissionAction(id: string, hold: boolean, fd: FormData) {
  await act(`/admin/commissions`, { perm: "COMMISSIONS", risk: { fd, action: hold ? "commission.hold" : "commission.release", target: id } }, async (adminId, reason) => {
    await setCommissionHold(id, hold, adminId, reason?.slice(0, 200));
    return hold ? "Commission held" : "Commission released";
  });
}

export async function adjustmentAction(fd: FormData) {
  await act(`/admin/commissions`, { perm: "COMMISSIONS", stepUp: true }, async (adminId) => {
    const v = z
      .object({ email: z.string().trim().toLowerCase().email(), amount: z.string().transform((a, ctx) => { try { const m = signedMinor(a); if (m === 0) throw 0; return m; } catch { ctx.addIssue({ code: "custom", message: "Enter a non-zero amount like -1500 or 2500.50" }); return z.NEVER; } }), note: z.string().trim().min(10, "Explain the correction (10+ characters)").max(300) })
      .parse({ email: str(fd, "email"), amount: str(fd, "amount"), note: str(fd, "note") });
    const u = await prisma.user.findUnique({ where: { email: v.email } });
    if (!u) throw new AppError("No member with that email.");
    // A correction is a new, permanent ledger entry with its reason; nothing existing is edited.
    await adjustWallet(u.id, { amountMinor: v.amount, reason: v.note }, adminId, z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).parse(str(fd, "formKey")));
    return "Correction posted to the member's wallet";
  });
}

// ---------- Payouts ----------

export async function reviewPayoutAction(id: string, decision: "APPROVE" | "REJECT", fd: FormData) {
  await act(`/admin/payouts`, { perm: "PAYOUTS", stepUp: true }, async (adminId) => {
    await reviewPayout(id, decision, adminId, { note: str(fd, "note"), accountChecked: fd.get("accountChecked") === "on" });
    return decision === "APPROVE" ? "Withdrawal approved" : "Withdrawal rejected and the amount returned to the member's wallet";
  });
}

export async function createBatchAction(fd: FormData) {
  await act(`/admin/payouts`, { perm: "PAYOUTS", stepUp: true }, async (adminId) => {
    const ids = fd.getAll("payoutId").filter((v): v is string => typeof v === "string");
    const b = await createPayoutBatch(ids, adminId);
    return `Batch ${b.number} created with ${b.count} withdrawal(s)`;
  });
}

export async function settlePayoutAction(id: string, fd: FormData) {
  await act(`/admin/payouts`, { perm: "PAYOUTS", stepUp: true }, async (adminId) => {
    await settlePayout(id, adminId, { reference: str(fd, "reference"), settledAt: lagosLocalToDate(str(fd, "settledAt")) ?? new Date(Number.NaN), evidence: str(fd, "evidence") });
    return "Withdrawal recorded as paid";
  });
}

export async function failPayoutAction(id: string, fd: FormData) {
  await act(`/admin/payouts`, { perm: "PAYOUTS", stepUp: true }, async (adminId) => {
    await failPayout(id, adminId, str(fd, "reason"));
    return "Withdrawal marked failed and the amount returned to the member's wallet";
  });
}

export async function requeuePayoutAction(id: string, fd: FormData) {
  await act(`/admin/payouts`, { perm: "PAYOUTS", stepUp: true, risk: { fd, action: "payout.requeue", target: id } }, async (adminId) => {
    await requeuePayout(id, adminId);
    return "Withdrawal queued again";
  });
}

// ---------- Support ----------

export async function staffReplyAction(ticketId: string, fd: FormData) {
  await act(`/admin/support/${ticketId}`, { perm: "SUPPORT" }, async (adminId) => {
    await replyTicket(ticketId, adminId, true, str(fd, "body"));
    if (fd.get("close") === "on") await closeTicket(ticketId);
    return "Reply sent";
  });
}

export async function contactHandledAction(id: string) {
  await act(`/admin/support`, { perm: "SUPPORT" }, async (adminId) => {
    await prisma.contactMessage.update({ where: { id }, data: { handled: true } });
    await audit("contact.handled", "ContactMessage", id, adminId);
    return "Marked as handled";
  });
}

// ---------- Settings ----------

export async function saveBrandAction(fd: FormData) {
  await act(`/admin/settings`, { perm: "SETTINGS" }, async (adminId) => {
    const before = await getBrand();
    const v = brandSchema.parse({
      companyName: str(fd, "companyName"), tagline: str(fd, "tagline"), logoUrl: str(fd, "logoUrl"), primaryColor: str(fd, "primaryColor"),
      accentColor: str(fd, "accentColor"), currency: str(fd, "currency"), supportEmail: str(fd, "supportEmail"), supportPhone: str(fd, "supportPhone"),
      address: str(fd, "address"), registrationNumber: str(fd, "registrationNumber"), about: str(fd, "about"),
    });
    if (v.currency !== before.currency && (await prisma.order.count()) > 0) {
      throw new AppError("Currency can't be changed after the first order. Prices and commissions would no longer add up.");
    }
    await saveSetting("brand", v);
    await audit("settings.brand", "Setting", "brand", adminId, { before, after: v });
    revalidatePath("/", "layout");
    return "Brand settings saved";
  });
}

/** Delivery and order settings. Tax and payout thresholds are kept as they are (see saveFinanceAction). */
export async function saveShopAction(fd: FormData) {
  await act(`/admin/settings`, { perm: "SETTINGS" }, async (adminId) => {
    const before = await getShopSettings();
    const v = shopSettingsSchema.parse({
      ...before,
      flatShippingMinor: toMinor(str(fd, "flatShipping")), freeShippingOverMinor: toMinor(str(fd, "freeShippingOver")),
      orderExpiryMinutes: num(fd, "orderExpiryMinutes"), returnWindowDays: num(fd, "returnWindowDays"), deliveryInfo: str(fd, "deliveryInfo"),
      perKgShippingMinor: toMinor(str(fd, "perKgShipping") || "0"),
    });
    await saveSetting("shop", v);
    await audit("settings.shop", "Setting", "shop", adminId, { before, after: v });
    return "Shop settings saved";
  });
}

/** Sensitive financial settings (VAT and the minimum withdrawal): super admin only, fresh authenticator code, and a reason. */
export async function saveFinanceAction(fd: FormData) {
  await act(`/admin/settings`, { superOnly: true, stepUp: true, risk: { fd, action: "settings.finance", target: "shop" } }, async (adminId, reason) => {
    const before = await getShopSettings();
    const v = shopSettingsSchema.parse({
      ...before,
      minPayoutMinor: toMinor(str(fd, "minPayout")),
      taxEnabled: fd.get("taxEnabled") === "on", taxRateBps: percentToBps(str(fd, "taxRate") || "0"), taxLabel: str(fd, "taxLabel") || "VAT",
      pricesIncludeTax: fd.get("pricesIncludeTax") === "on", taxShipping: fd.get("taxShipping") === "on",
    });
    await saveSetting("shop", v);
    await audit("settings.finance", "Setting", "shop", adminId, { before, after: v, reason, privileged: true });
    return "Tax and withdrawal settings saved";
  });
}

/** The plan form's "version note" is its reason. */
function planFd(fd: FormData) {
  if (!fd.has("reason")) fd.set("reason", str(fd, "versionNote"));
  return fd;
}

/** Sensitive financial setting: super admin only, with a fresh authenticator code. */
export async function saveCompPlanAction(fd: FormData) {
  await act(`/admin/settings`, { superOnly: true, stepUp: true, risk: { fd: planFd(fd), action: "settings.compPlan", target: "compPlan", confirm: "PUBLISH" } }, async (adminId) => {
    const v = compPlanSchema.parse({
      directRateBps: percentToBps(str(fd, "directRate")), directOnMemberPurchases: fd.get("directOnMemberPurchases") === "on",
      binaryEnabled: fd.get("binaryEnabled") === "on", binaryRetailOnly: fd.get("binaryRetailOnly") === "on", pairUnitPv: num(fd, "pairUnitPv"), pairingRatio: str(fd, "pairingRatio"),
      pairValueMinor: toMinor(str(fd, "pairValue")), dailyCapMinor: toMinor(str(fd, "dailyCap")), carryForward: fd.get("carryForward") === "on",
      maxCarryPv: num(fd, "maxCarryPv"), holdDays: num(fd, "holdDays"), requireDirectOnEachLeg: fd.get("requireDirectOnEachLeg") === "on",
      minPersonalPv: num(fd, "minPersonalPv"), defaultPlacement: str(fd, "defaultPlacement"),
      placementMode: str(fd, "placementMode"),
    });
    const note = str(fd, "versionNote").trim();
    if (note.length < 5) throw new AppError("Describe the change (who approved it and why). It's kept with the plan version.");
    const version = await publishPlan(v, adminId, note);
    return `Plan version ${version.version} saved. It applies to orders paid from now on and the next binary run; earlier orders keep their version.`;
  });
}

// ---------- Network ----------

/** Places a member who is waiting for approval. Needs NETWORK permission and a fresh authenticator code. */
export async function placeMemberAction(userId: string, fd: FormData) {
  await act("/admin/network", { perm: "NETWORK", stepUp: true, risk: { fd, action: "network.place", target: userId, confirm: "PLACE" } }, async (adminId, reason) => {
    const [parentNodeId, leg] = str(fd, "slot").split(":");
    if (!parentNodeId || (leg !== "LEFT" && leg !== "RIGHT")) throw new AppError("Choose an open position.");
    const note = reason;
    await prisma.$transaction(async (tx) => {
      const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!u.placementPending) throw new AppError("This member isn't waiting for placement.");
      if (u.role === "CUSTOMER") throw new AppError("Only affiliates are placed in the network.");
      const node = await placeInTree(tx, userId, u.sponsorId, leg, { method: "ADMIN", actorId: adminId, parentNodeId, note: note ?? undefined });
      await audit("network.place", "User", userId, adminId, { nodeId: node.id, parentNodeId, leg, note }, tx);
      await notify(userId, "You've been placed in the network", `Your position is on the ${leg.toLowerCase()} side. This doesn't earn anything by itself: commissions come only from completed product sales.`, "/dashboard", tx, "account");
    });
    return "Member placed";
  });
}

export async function reconcileVolumeAction() {
  await act("/admin/risk", { perm: "RISK" }, async (adminId) => {
    const r = await reconcileVolume(adminId);
    return r.issueCount ? `Found ${r.issueCount} mismatch(es). See the network ledger check below.` : `All ${r.nodes} positions and ${r.orders} orders match the ledger.`;
  });
}

// ---------- Super admin: team and emergency operations ----------

const PERMS: AdminPermission[] = ["ORDERS", "PRODUCTS", "MEMBERS", "NETWORK", "COMMISSIONS", "PAYOUTS", "SUPPORT", "RISK", "SETTINGS", "AUDIT", "PRODUCT_COSTS"];

export async function grantAdminAction(fd: FormData) {
  await act(`/admin/team`, { superOnly: true, stepUp: true, risk: { fd, action: "admin.grant", target: str(fd, "email") } }, async (adminId) => {
    const email = z.string().trim().toLowerCase().email().parse(str(fd, "email"));
    const u = await prisma.user.findUnique({ where: { email } });
    if (!u) throw new AppError("No account with that email. Ask them to register first.");
    if (u.role === "ADMIN" || u.role === "SUPER_ADMIN") throw new AppError("They're already an administrator.");
    const permissions = PERMS.filter((p) => fd.get(`perm_${p}`) === "on");
    await prisma.user.update({ where: { id: u.id }, data: { role: "ADMIN", adminPermissions: permissions } });
    await prisma.session.deleteMany({ where: { userId: u.id } }); // must sign in again (and set up two-step verification)
    await audit("admin.grant", "User", u.id, adminId, { from: u.role, permissions, privileged: true });
    return `${u.name} is now an administrator`;
  });
}

export async function setAdminPermissionsAction(userId: string, fd: FormData) {
  await act(`/admin/team`, { superOnly: true, stepUp: true, risk: { fd, action: "admin.permissions", target: userId } }, async (adminId) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (u.role !== "ADMIN") throw new AppError("Only administrators have editable permissions.");
    const permissions = PERMS.filter((p) => fd.get(`perm_${p}`) === "on");
    await prisma.user.update({ where: { id: userId }, data: { adminPermissions: permissions } });
    await audit("admin.permissions", "User", userId, adminId, { before: u.adminPermissions, after: permissions, privileged: true });
    return "Permissions updated";
  });
}

export async function revokeAdminAction(userId: string, fd: FormData) {
  await act(`/admin/team`, { superOnly: true, stepUp: true, risk: { fd, action: "admin.revoke", target: userId, confirm: "REMOVE" } }, async (adminId) => {
    if (userId === adminId) throw new AppError("You can't remove your own access.");
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { node: true } });
    if (u.role === "SUPER_ADMIN") {
      const supers = await prisma.user.count({ where: { role: "SUPER_ADMIN", status: "ACTIVE" } });
      if (supers <= 1) throw new AppError("There must always be at least one super administrator.");
    }
    await prisma.user.update({ where: { id: userId }, data: { role: u.node ? "AFFILIATE" : "CUSTOMER", adminPermissions: [] } });
    await prisma.session.deleteMany({ where: { userId } });
    await audit("admin.revoke", "User", userId, adminId, { from: u.role, privileged: true });
    return "Administrator access removed";
  });
}

export async function promoteSuperAction(userId: string, fd: FormData) {
  await act(`/admin/team`, { superOnly: true, stepUp: true, risk: { fd, action: "admin.promoteSuper", target: userId, confirm: "PROMOTE" } }, async (adminId) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (u.role !== "ADMIN") throw new AppError("Only an existing administrator can be promoted.");
    if (!u.mfaEnabledAt) throw new AppError("They must turn on two-step verification first.");
    await prisma.user.update({ where: { id: userId }, data: { role: "SUPER_ADMIN" } });
    await audit("admin.promoteSuper", "User", userId, adminId, { privileged: true });
    return "Promoted to super administrator";
  });
}

export async function saveOpsAction(fd: FormData) {
  await act(`/admin/operations`, { superOnly: true, stepUp: true, risk: { fd, action: "ops.update", target: "ops" } }, async (adminId) => {
    const before = await getOps();
    const v = opsSchema.parse({
      checkoutPaused: fd.get("checkoutPaused") === "on", payoutsPaused: fd.get("payoutsPaused") === "on",
      commissionsPaused: fd.get("commissionsPaused") === "on", notice: str(fd, "notice"),
    });
    await saveSetting("ops", v);
    await audit("ops.update", "Setting", "ops", adminId, { before, after: v, privileged: true });
    revalidatePath("/", "layout");
    return "Emergency settings saved";
  });
}

export async function resetMfaAction(fd: FormData) {
  await act(`/admin/operations`, { superOnly: true, stepUp: true, risk: { fd, action: "mfa.reset", target: str(fd, "email"), confirm: "RESET" } }, async (adminId) => {
    const email = z.string().trim().toLowerCase().email().parse(str(fd, "email"));
    const u = await prisma.user.findUnique({ where: { email } });
    if (!u) throw new AppError("No account with that email.");
    if (u.id === adminId) throw new AppError("Use your own recovery codes instead.");
    await resetMfa(u.id, adminId);
    return `Two-step verification reset for ${u.email}. They'll set it up again at next sign-in.`;
  });
}

export async function revokeAllSessionsAction(fd: FormData) {
  await act(`/admin/operations`, { superOnly: true, stepUp: true, risk: { fd, action: "ops.revokeAllSessions", confirm: "SIGN OUT EVERYONE" } }, async (adminId) => {
    const r = await prisma.session.deleteMany({ where: { NOT: { userId: adminId } } });
    await audit("ops.revokeAllSessions", "Session", null, adminId, { count: r.count, privileged: true });
    return `Signed out ${r.count} session(s)`;
  });
}

export async function reconcileLedgerAction() {
  await act("/admin/risk", { perm: "RISK" }, async (adminId) => {
    const r = await reconcileLedger(adminId);
    return r.ok ? `Wallet ledger matches: ${r.members} member wallet(s) checked.` : `Found ${r.problems.length} wallet ledger problem(s). See the wallet ledger check below.`;
  });
}

export async function verifyAuditAction() {
  await act("/admin/audit", { perm: "AUDIT" }, async (adminId) => {
    const r = await verifyAuditChain();
    await audit("audit.verify", "AuditLog", null, adminId, { ok: r.ok, checked: r.checked, latestPos: r.latestPos, brokenAt: r.brokenAt ?? null });
    return r.ok ? `Audit trail intact: ${r.checked} record(s) verified.` : `Audit trail broken at record ${r.brokenAt?.chainPos}: ${r.brokenAt?.problem}.`;
  });
}

// ---------- Discount codes ----------

export async function saveDiscountAction(fd: FormData) {
  await act("/admin/discounts", { perm: "SETTINGS", stepUp: true }, async (adminId) => {
    const type = z.enum(["PERCENT", "FIXED"]).parse(str(fd, "type"));
    const code = normaliseCode(str(fd, "code"));
    if (!/^[A-Z0-9_-]{3,40}$/.test(code)) throw new AppError("Codes are 3–40 letters, numbers, dashes or underscores.");
    const value = type === "PERCENT" ? percentToBps(str(fd, "value")) : toMinor(str(fd, "value"));
    if (value <= 0) throw new AppError("Enter a discount above zero.");
    const optionalInt = (k: string) => (str(fd, k).trim() ? Number(z.string().regex(/^\d{1,7}$/, "Use whole numbers").parse(str(fd, k).trim())) : null);
    const data = {
      code, type, value,
      description: z.string().trim().min(3).max(200).parse(str(fd, "description")),
      maxDiscountMinor: optionalMinor(str(fd, "maxDiscount")),
      minSubtotalMinor: optionalMinor(str(fd, "minSubtotal")) ?? 0,
      maxRedemptions: optionalInt("maxRedemptions"),
      perCustomerLimit: optionalInt("perCustomerLimit") ?? 1,
      startsAt: lagosLocalToDate(str(fd, "startsAt")),
      endsAt: lagosLocalToDate(str(fd, "endsAt")),
      createdById: adminId,
    };
    if (data.perCustomerLimit < 1) throw new AppError("Uses per customer must be at least 1.");
    if (data.startsAt && data.endsAt && data.endsAt <= data.startsAt) throw new AppError("The end must be after the start.");
    try {
      const c = await prisma.discountCode.create({ data });
      await audit("discount.create", "DiscountCode", c.id, adminId, { ...data, startsAt: data.startsAt?.toISOString() ?? null, endsAt: data.endsAt?.toISOString() ?? null });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") throw new AppError("That code already exists.");
      throw e;
    }
    return `Code ${code} created`;
  });
}

export async function toggleDiscountAction(id: string, active: boolean) {
  await act("/admin/discounts", { perm: "SETTINGS" }, async (adminId) => {
    await prisma.discountCode.update({ where: { id }, data: { active } });
    await audit(active ? "discount.enable" : "discount.disable", "DiscountCode", id, adminId);
    return active ? "Code switched on" : "Code switched off";
  });
}

// ---------- Stockists ----------

export async function saveStockistAction(id: string | null, fd: FormData) {
  await act(`/admin/stockists`, { perm: "PRODUCTS" }, async (adminId) => {
    const v = z
      .object({
        name: z.string().trim().min(2).max(100),
        state: z.string().trim().min(2).max(60),
        city: z.string().trim().min(2).max(60),
        address: z.string().trim().min(5).max(300),
        phone: z.string().trim().max(30).regex(/^[0-9+()\s-]*$/, "Phone number can only contain digits, spaces and + ( ) -"),
        hours: z.string().trim().max(100),
        active: z.boolean(),
      })
      .parse({ name: str(fd, "name"), state: str(fd, "state"), city: str(fd, "city"), address: str(fd, "address"), phone: str(fd, "phone"), hours: str(fd, "hours"), active: fd.get("active") === "on" });
    const data = { ...v, phone: v.phone || null, hours: v.hours || null };
    const s = id ? await prisma.stockist.update({ where: { id }, data }) : await prisma.stockist.create({ data });
    await audit("stockist.save", "Stockist", s.id, adminId, data);
    return "Stockist saved";
  });
}

export async function deleteStockistAction(id: string) {
  await act(`/admin/stockists`, { perm: "PRODUCTS" }, async (adminId) => {
    await prisma.stockist.delete({ where: { id } });
    await audit("stockist.delete", "Stockist", id, adminId);
    return "Deleted";
  });
}
