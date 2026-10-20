"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma, type AdminPermission } from "@prisma/client";
import { z } from "zod";
import { hasRecentStepUp, requireAdmin, requireSuperAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { runAction, str, type ActionState } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { toMinor } from "@/lib/money";
import { cancelPendingOrder, refundOrder, updateFulfilment } from "@/lib/orders";
import { matureOrders, runBinary, setCommissionHold } from "@/lib/commissions";
import { processPayout } from "@/lib/wallet";
import { resolveReturn } from "@/lib/returns";
import { closeTicket, replyTicket } from "@/lib/support";
import { resetMfa } from "@/lib/mfa";
import { notify } from "@/lib/notify";
import {
  brandSchema, compPlanSchema, getBrand, getCompPlan, getOps, getShopSettings, opsSchema, saveSetting, shopSettingsSchema,
} from "@/lib/settings";

type Guard = { perm?: AdminPermission; superOnly?: boolean; stepUp?: boolean };

/**
 * Every admin mutation goes through here: authorisation is checked on the server for each call,
 * sensitive ones also need a recent authenticator code. Returns to `path` with a message.
 */
async function act(path: string, guard: Guard, fn: (adminId: string) => Promise<string | void>) {
  const admin = guard.superOnly ? await requireSuperAdmin() : await requireAdmin(guard.perm);
  if (guard.stepUp && !(await hasRecentStepUp())) {
    redirect(`/admin/verify?next=${encodeURIComponent(path)}`);
  }
  const res = await runAction(async () => {
    const ok = await fn(admin.id);
    return ok ? { ok } : null;
  });
  revalidatePath(path);
  const sep = path.includes("?") ? "&" : "?";
  const q = res?.error ? `${sep}error=${encodeURIComponent(res.error)}` : res?.ok ? `${sep}ok=${encodeURIComponent(res.ok)}` : "";
  redirect(`${path}${q}`);
}

const num = (fd: FormData, k: string) => Number(str(fd, k));

// ---------- Products, categories, testimonials ----------

const productInput = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and dashes").max(120),
  sku: z.string().trim().toUpperCase().min(2).max(40),
  description: z.string().trim().min(10).max(5000),
  price: z.coerce.number().positive().max(100_000_000),
  pv: z.coerce.number().int().min(0).max(1_000_000),
  lowStockThreshold: z.coerce.number().int().min(0).max(100_000),
  weightGrams: z.coerce.number().int().min(0).max(1_000_000),
  imageUrl: z.string().trim().url().or(z.literal("")),
  images: z.string().max(4000),
  categoryId: z.string().max(40),
  active: z.boolean(),
  featured: z.boolean(),
  initialStock: z.coerce.number().int().min(0).max(1_000_000).optional(),
});
export type ProductInput = z.input<typeof productInput>;

export async function saveProductAction(id: string | null, raw: ProductInput): Promise<ActionState> {
  const admin = await requireAdmin("PRODUCTS");
  let savedId = id;
  const res = await runAction(async () => {
    const v = productInput.parse(raw);
    const images = v.images.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    for (const u of images) z.string().url().parse(u);
    const data = {
      name: v.name, slug: v.slug, sku: v.sku, description: v.description, priceMinor: toMinor(v.price), pv: v.pv,
      lowStockThreshold: v.lowStockThreshold, weightGrams: v.weightGrams, imageUrl: v.imageUrl || null, images: images.slice(0, 8),
      categoryId: v.categoryId || null, active: v.active, featured: v.featured,
    };
    try {
      if (id) {
        const before = await prisma.product.findUniqueOrThrow({ where: { id } });
        await prisma.product.update({ where: { id }, data });
        await audit("product.update", "Product", id, admin.id, { priceBefore: before.priceMinor, pvBefore: before.pv, ...data });
      } else {
        const stock = v.initialStock ?? 0;
        const p = await prisma.product.create({ data: { ...data, stock } });
        if (stock > 0) await prisma.inventoryMovement.create({ data: { productId: p.id, delta: stock, reason: "RESTOCK", actorId: admin.id, note: "Initial stock" } });
        await audit("product.create", "Product", p.id, admin.id, data);
        savedId = p.id;
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new AppError("That SKU or URL slug is already used.");
      throw e;
    }
  });
  if (res) return res;
  revalidatePath("/admin/products");
  redirect(`/admin/products/${savedId}?ok=Saved`);
}

export async function adjustStockAction(productId: string, fd: FormData) {
  await act(`/admin/products/${productId}`, { perm: "PRODUCTS" }, async (adminId) => {
    const v = z
      .object({ delta: z.coerce.number().int().refine((n) => n !== 0, "Enter a non-zero amount"), reason: z.enum(["RESTOCK", "ADJUSTMENT"]), note: z.string().trim().min(3, "Add a note").max(300) })
      .parse({ delta: str(fd, "delta"), reason: str(fd, "reason"), note: str(fd, "note") });
    await prisma.$transaction(async (tx) => {
      const r = await tx.product.updateMany({ where: { id: productId, stock: { gte: v.delta < 0 ? -v.delta : 0 } }, data: { stock: { increment: v.delta } } });
      if (r.count === 0) throw new AppError("Stock can't go below zero.");
      await tx.inventoryMovement.create({ data: { productId, delta: v.delta, reason: v.reason, note: v.note, actorId: adminId } });
      await audit("inventory.adjust", "Product", productId, adminId, v, tx);
    });
    return "Stock updated";
  });
}

export async function saveCategoryAction(id: string | null, fd: FormData) {
  await act(`/admin/categories`, { perm: "PRODUCTS" }, async (adminId) => {
    const v = z
      .object({ name: z.string().trim().min(2).max(60), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).max(60), description: z.string().trim().max(300), sortOrder: z.coerce.number().int(), active: z.boolean() })
      .parse({ name: str(fd, "name"), slug: str(fd, "slug"), description: str(fd, "description"), sortOrder: str(fd, "sortOrder") || "0", active: fd.get("active") === "on" });
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
export async function refundOrderAction(orderId: string, fd: FormData) {
  await act(`/admin/orders/${orderId}`, { perm: "ORDERS", stepUp: true }, async (adminId) => {
    if (str(fd, "confirm") !== "REFUND") throw new AppError("Type REFUND to confirm.");
    await refundOrder(orderId, adminId, { restock: fd.get("restock") === "on", reason: str(fd, "reason").slice(0, 300) });
    return "Order refunded";
  });
}
export async function cancelOrderAdminAction(orderId: string) {
  await act(`/admin/orders/${orderId}`, { perm: "ORDERS" }, async (adminId) => {
    await cancelPendingOrder(orderId, adminId);
    return "Order cancelled and stock released";
  });
}
export async function resolveReturnAction(id: string, action: "APPROVE" | "REFUND" | "REJECT", fd: FormData) {
  await act(`/admin/returns`, { perm: "ORDERS", stepUp: action === "REFUND" }, async (adminId) => {
    await resolveReturn(id, action, adminId, { note: str(fd, "note").trim().slice(0, 500), restock: fd.get("restock") === "on" });
    return `Return ${action === "REFUND" ? "refunded" : action === "APPROVE" ? "approved" : "rejected"}`;
  });
}

// ---------- Members ----------

export async function setUserStatusAction(userId: string, status: "ACTIVE" | "SUSPENDED") {
  await act(`/admin/users/${userId}`, { perm: "MEMBERS" }, async (adminId) => {
    if (userId === adminId) throw new AppError("You can't change your own status.");
    const target = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (target.role === "SUPER_ADMIN") throw new AppError("Super administrators can't be suspended here.");
    await prisma.user.update({ where: { id: userId }, data: { status } });
    if (status === "SUSPENDED") await prisma.session.deleteMany({ where: { userId } });
    await audit(`user.${status.toLowerCase()}`, "User", userId, adminId);
    return status === "SUSPENDED" ? "Member suspended and signed out" : "Member reactivated";
  });
}

export async function revokeSessionsAction(userId: string) {
  await act(`/admin/users/${userId}`, { perm: "MEMBERS" }, async (adminId) => {
    const r = await prisma.session.deleteMany({ where: { userId } });
    await audit("user.revokeSessions", "User", userId, adminId, { count: r.count });
    return `Signed out of ${r.count} session(s)`;
  });
}

// ---------- Commissions ----------

export async function matureNowAction() {
  await act(`/admin/commissions`, { perm: "COMMISSIONS" }, async () => `${await matureOrders()} order(s) approved`);
}

export async function runBinaryAction(fd: FormData) {
  await act(`/admin/commissions`, { perm: "COMMISSIONS", stepUp: true }, async (adminId) => {
    const period = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date").parse(str(fd, "period"));
    const r = await runBinary(period, adminId);
    return `Binary for ${period}: ${r.pairsPaid} pairs paid`;
  });
}

export async function holdCommissionAction(id: string, hold: boolean, fd: FormData) {
  await act(`/admin/commissions`, { perm: "COMMISSIONS" }, async (adminId) => {
    await setCommissionHold(id, hold, adminId, str(fd, "reason").trim().slice(0, 200) || undefined);
    return hold ? "Commission held" : "Commission released";
  });
}

export async function adjustmentAction(fd: FormData) {
  await act(`/admin/commissions`, { perm: "COMMISSIONS", stepUp: true }, async (adminId) => {
    const v = z
      .object({ email: z.string().trim().toLowerCase().email(), amount: z.coerce.number().refine((n) => n !== 0), note: z.string().trim().min(5, "Explain the adjustment").max(300) })
      .parse({ email: str(fd, "email"), amount: str(fd, "amount"), note: str(fd, "note") });
    const u = await prisma.user.findUnique({ where: { email: v.email } });
    if (!u) throw new AppError("No member with that email.");
    if (u.id === adminId) throw new AppError("You can't adjust your own earnings.");
    const c = await prisma.commission.create({ data: { userId: u.id, type: "ADJUSTMENT", status: "APPROVED", approvedAt: new Date(), amountMinor: toMinor(v.amount), note: v.note } });
    await notify(u.id, "Commission adjustment", v.note, "/dashboard/commissions");
    await audit("commission.adjust", "Commission", c.id, adminId, { userId: u.id, amountMinor: c.amountMinor, note: v.note });
    return "Adjustment recorded";
  });
}

// ---------- Payouts ----------

export async function payoutDecisionAction(id: string, action: "APPROVE" | "PAY" | "REJECT", fd: FormData) {
  await act(`/admin/payouts`, { perm: "PAYOUTS", stepUp: action === "PAY" }, async (adminId) => {
    await processPayout(id, action, adminId, str(fd, "reference").trim() || undefined, str(fd, "note").trim() || undefined);
    return `Payout ${action === "PAY" ? "marked paid" : action === "APPROVE" ? "approved" : "rejected"}`;
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

export async function saveShopAction(fd: FormData) {
  await act(`/admin/settings`, { perm: "SETTINGS" }, async (adminId) => {
    const before = await getShopSettings();
    const v = shopSettingsSchema.parse({
      flatShippingMinor: toMinor(str(fd, "flatShipping")), freeShippingOverMinor: toMinor(str(fd, "freeShippingOver")),
      minPayoutMinor: toMinor(str(fd, "minPayout")), orderExpiryMinutes: num(fd, "orderExpiryMinutes"),
      returnWindowDays: num(fd, "returnWindowDays"), deliveryInfo: str(fd, "deliveryInfo"),
    });
    await saveSetting("shop", v);
    await audit("settings.shop", "Setting", "shop", adminId, { before, after: v });
    return "Shop settings saved";
  });
}

/** Sensitive financial setting: super admin only, with a fresh authenticator code. */
export async function saveCompPlanAction(fd: FormData) {
  await act(`/admin/settings`, { superOnly: true, stepUp: true }, async (adminId) => {
    const before = await getCompPlan();
    const v = compPlanSchema.parse({
      directBonusPercent: num(fd, "directBonusPercent"), pairUnitPv: num(fd, "pairUnitPv"), pairingRatio: str(fd, "pairingRatio"),
      pairValueMinor: toMinor(str(fd, "pairValue")), dailyCapMinor: toMinor(str(fd, "dailyCap")), carryForward: fd.get("carryForward") === "on",
      maxCarryPv: num(fd, "maxCarryPv"), holdDays: num(fd, "holdDays"), requireDirectOnEachLeg: fd.get("requireDirectOnEachLeg") === "on",
      minPersonalPv: num(fd, "minPersonalPv"), defaultPlacement: str(fd, "defaultPlacement"),
    });
    await saveSetting("compPlan", v);
    await audit("settings.compPlan", "Setting", "compPlan", adminId, { before, after: v, privileged: true });
    return "Compensation plan saved. It applies to new orders and the next binary run.";
  });
}

// ---------- Super admin: team and emergency operations ----------

const PERMS: AdminPermission[] = ["ORDERS", "PRODUCTS", "MEMBERS", "NETWORK", "COMMISSIONS", "PAYOUTS", "SUPPORT", "RISK", "SETTINGS", "AUDIT"];

export async function grantAdminAction(fd: FormData) {
  await act(`/admin/team`, { superOnly: true, stepUp: true }, async (adminId) => {
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
  await act(`/admin/team`, { superOnly: true, stepUp: true }, async (adminId) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (u.role !== "ADMIN") throw new AppError("Only administrators have editable permissions.");
    const permissions = PERMS.filter((p) => fd.get(`perm_${p}`) === "on");
    await prisma.user.update({ where: { id: userId }, data: { adminPermissions: permissions } });
    await audit("admin.permissions", "User", userId, adminId, { before: u.adminPermissions, after: permissions, privileged: true });
    return "Permissions updated";
  });
}

export async function revokeAdminAction(userId: string) {
  await act(`/admin/team`, { superOnly: true, stepUp: true }, async (adminId) => {
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

export async function promoteSuperAction(userId: string) {
  await act(`/admin/team`, { superOnly: true, stepUp: true }, async (adminId) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (u.role !== "ADMIN") throw new AppError("Only an existing administrator can be promoted.");
    if (!u.mfaEnabledAt) throw new AppError("They must turn on two-step verification first.");
    await prisma.user.update({ where: { id: userId }, data: { role: "SUPER_ADMIN" } });
    await audit("admin.promoteSuper", "User", userId, adminId, { privileged: true });
    return "Promoted to super administrator";
  });
}

export async function saveOpsAction(fd: FormData) {
  await act(`/admin/operations`, { superOnly: true, stepUp: true }, async (adminId) => {
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
  await act(`/admin/operations`, { superOnly: true, stepUp: true }, async (adminId) => {
    const email = z.string().trim().toLowerCase().email().parse(str(fd, "email"));
    if (str(fd, "confirm") !== "RESET") throw new AppError("Type RESET to confirm.");
    const u = await prisma.user.findUnique({ where: { email } });
    if (!u) throw new AppError("No account with that email.");
    if (u.id === adminId) throw new AppError("Use your own recovery codes instead.");
    await resetMfa(u.id, adminId);
    return `Two-step verification reset for ${u.email}. They'll set it up again at next sign-in.`;
  });
}

export async function revokeAllSessionsAction(fd: FormData) {
  await act(`/admin/operations`, { superOnly: true, stepUp: true }, async (adminId) => {
    if (str(fd, "confirm") !== "SIGN OUT EVERYONE") throw new AppError("Type SIGN OUT EVERYONE to confirm.");
    const r = await prisma.session.deleteMany({ where: { NOT: { userId: adminId } } });
    await audit("ops.revokeAllSessions", "Session", null, adminId, { count: r.count, privileged: true });
    return `Signed out ${r.count} session(s)`;
  });
}
