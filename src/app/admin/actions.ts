"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { runAction, str, type ActionState } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { toMinor } from "@/lib/money";
import { cancelPendingOrder, refundOrder, updateFulfilment } from "@/lib/orders";
import { matureOrders, runBinary } from "@/lib/commissions";
import { processPayout } from "@/lib/wallet";
import { brandSchema, compPlanSchema, getBrand, getCompPlan, getShopSettings, saveSetting, shopSettingsSchema } from "@/lib/settings";

/** Runs an admin form action and comes back to `path` with a success or error message. */
async function act(path: string, fn: (adminId: string) => Promise<string | void>) {
  const admin = await requireAdmin();
  const res = await runAction(async () => {
    const ok = await fn(admin.id);
    return ok ? { ok } : null;
  });
  revalidatePath(path);
  const q = res?.error ? `?error=${encodeURIComponent(res.error)}` : res?.ok ? `?ok=${encodeURIComponent(res.ok)}` : "";
  redirect(`${path}${q}`);
}

// ---------- Products ----------

export const productInput = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and dashes").max(120),
  sku: z.string().trim().toUpperCase().min(2).max(40),
  description: z.string().trim().min(10).max(5000),
  price: z.coerce.number().positive().max(100_000_000),
  pv: z.coerce.number().int().min(0).max(1_000_000),
  lowStockThreshold: z.coerce.number().int().min(0).max(100_000),
  weightGrams: z.coerce.number().int().min(0).max(1_000_000),
  imageUrl: z.string().trim().url().or(z.literal("")),
  active: z.boolean(),
  initialStock: z.coerce.number().int().min(0).max(1_000_000).optional(),
});
export type ProductInput = z.input<typeof productInput>;

export async function saveProductAction(id: string | null, raw: ProductInput): Promise<ActionState> {
  const admin = await requireAdmin();
  let savedId = id;
  const res = await runAction(async () => {
    const v = productInput.parse(raw);
    const data = {
      name: v.name, slug: v.slug, sku: v.sku, description: v.description, priceMinor: toMinor(v.price), pv: v.pv,
      lowStockThreshold: v.lowStockThreshold, weightGrams: v.weightGrams, imageUrl: v.imageUrl || null, active: v.active,
    };
    try {
      if (id) {
        await prisma.product.update({ where: { id }, data });
        await audit("product.update", "Product", id, admin.id, data);
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
  await act(`/admin/products/${productId}`, async (adminId) => {
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

// ---------- Orders ----------

export async function shipOrderAction(orderId: string, fd: FormData) {
  await act(`/admin/orders/${orderId}`, async (adminId) => {
    await updateFulfilment(orderId, "SHIPPED", adminId, str(fd, "trackingRef").trim().slice(0, 100));
    return "Marked as shipped";
  });
}
export async function deliverOrderAction(orderId: string) {
  await act(`/admin/orders/${orderId}`, async (adminId) => {
    await updateFulfilment(orderId, "DELIVERED", adminId);
    return "Marked as delivered";
  });
}
export async function refundOrderAction(orderId: string, fd: FormData) {
  await act(`/admin/orders/${orderId}`, async (adminId) => {
    if (str(fd, "confirm") !== "REFUND") throw new AppError('Type REFUND to confirm.');
    await refundOrder(orderId, adminId, { restock: fd.get("restock") === "on", reason: str(fd, "reason").slice(0, 300) });
    return "Order refunded";
  });
}
export async function cancelOrderAdminAction(orderId: string) {
  await act(`/admin/orders/${orderId}`, async (adminId) => {
    await cancelPendingOrder(orderId, adminId);
    return "Order cancelled and stock released";
  });
}

// ---------- Members ----------

export async function setUserStatusAction(userId: string, status: "ACTIVE" | "SUSPENDED") {
  await act(`/admin/users`, async (adminId) => {
    if (userId === adminId) throw new AppError("You can't change your own status.");
    await prisma.user.update({ where: { id: userId }, data: { status } });
    if (status === "SUSPENDED") await prisma.session.deleteMany({ where: { userId } });
    await audit(`user.${status.toLowerCase()}`, "User", userId, adminId);
    return status === "SUSPENDED" ? "Member suspended" : "Member reactivated";
  });
}

export async function setUserRoleAction(userId: string, fd: FormData) {
  await act(`/admin/users`, async (adminId) => {
    const role = z.enum(["AFFILIATE", "ADMIN"]).parse(str(fd, "role"));
    if (userId === adminId) throw new AppError("You can't change your own role.");
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { node: true } });
    if (!u.node) throw new AppError("Only affiliates can be given roles here.");
    await prisma.user.update({ where: { id: userId }, data: { role } });
    await audit("user.role", "User", userId, adminId, { from: u.role, to: role });
    return "Role updated";
  });
}

// ---------- Commissions ----------

export async function matureNowAction() {
  await act(`/admin/commissions`, async () => `${await matureOrders()} order(s) credited`);
}

export async function runBinaryAction(fd: FormData) {
  await act(`/admin/commissions`, async (adminId) => {
    const period = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date").parse(str(fd, "period"));
    const r = await runBinary(period, adminId);
    return `Binary for ${period}: ${r.pairsPaid} pairs paid`;
  });
}

export async function adjustmentAction(fd: FormData) {
  await act(`/admin/commissions`, async (adminId) => {
    const v = z
      .object({ email: z.string().trim().toLowerCase().email(), amount: z.coerce.number().refine((n) => n !== 0), note: z.string().trim().min(5, "Explain the adjustment").max(300) })
      .parse({ email: str(fd, "email"), amount: str(fd, "amount"), note: str(fd, "note") });
    const u = await prisma.user.findUnique({ where: { email: v.email } });
    if (!u) throw new AppError("No member with that email.");
    const c = await prisma.commission.create({ data: { userId: u.id, type: "ADJUSTMENT", amountMinor: toMinor(v.amount), note: v.note } });
    await audit("commission.adjust", "Commission", c.id, adminId, { userId: u.id, amountMinor: c.amountMinor, note: v.note });
    return "Adjustment recorded";
  });
}

// ---------- Payouts ----------

export async function payoutDecisionAction(id: string, action: "APPROVE" | "PAY" | "REJECT", fd: FormData) {
  await act(`/admin/payouts`, async (adminId) => {
    await processPayout(id, action, adminId, str(fd, "reference").trim() || undefined, str(fd, "note").trim() || undefined);
    return `Payout ${action === "PAY" ? "marked paid" : action === "APPROVE" ? "approved" : "rejected"}`;
  });
}

// ---------- Settings ----------

function num(fd: FormData, k: string) {
  return Number(str(fd, k));
}

export async function saveBrandAction(fd: FormData) {
  await act(`/admin/settings`, async (adminId) => {
    const before = await getBrand();
    const v = brandSchema.parse({
      companyName: str(fd, "companyName"), tagline: str(fd, "tagline"), logoUrl: str(fd, "logoUrl"), primaryColor: str(fd, "primaryColor"),
      accentColor: str(fd, "accentColor"), currency: str(fd, "currency"), supportEmail: str(fd, "supportEmail"), supportPhone: str(fd, "supportPhone"),
    });
    await saveSetting("brand", v);
    await audit("settings.brand", "Setting", "brand", adminId, { before, after: v });
    revalidatePath("/", "layout");
    return "Brand settings saved";
  });
}

export async function saveShopAction(fd: FormData) {
  await act(`/admin/settings`, async (adminId) => {
    const before = await getShopSettings();
    const v = shopSettingsSchema.parse({
      flatShippingMinor: toMinor(str(fd, "flatShipping")), freeShippingOverMinor: toMinor(str(fd, "freeShippingOver")),
      minPayoutMinor: toMinor(str(fd, "minPayout")), orderExpiryMinutes: num(fd, "orderExpiryMinutes"),
    });
    await saveSetting("shop", v);
    await audit("settings.shop", "Setting", "shop", adminId, { before, after: v });
    return "Shop settings saved";
  });
}

export async function saveCompPlanAction(fd: FormData) {
  await act(`/admin/settings`, async (adminId) => {
    const before = await getCompPlan();
    const v = compPlanSchema.parse({
      directBonusPercent: num(fd, "directBonusPercent"), pairUnitPv: num(fd, "pairUnitPv"), pairingRatio: str(fd, "pairingRatio"),
      pairValueMinor: toMinor(str(fd, "pairValue")), dailyCapMinor: toMinor(str(fd, "dailyCap")), carryForward: fd.get("carryForward") === "on",
      maxCarryPv: num(fd, "maxCarryPv"), holdDays: num(fd, "holdDays"), requireDirectOnEachLeg: fd.get("requireDirectOnEachLeg") === "on",
      minPersonalPv: num(fd, "minPersonalPv"), defaultPlacement: str(fd, "defaultPlacement"),
    });
    await saveSetting("compPlan", v);
    await audit("settings.compPlan", "Setting", "compPlan", adminId, { before, after: v });
    return "Compensation plan saved. Changes apply from the next run.";
  });
}
