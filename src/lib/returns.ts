import { z } from "zod";
import { prisma } from "./db";
import { AppError } from "./errors";
import { getShopSettings } from "./settings";
import { audit } from "./audit";
import { notify } from "./notify";
import { refundOrder } from "./refunds";
import { LIVE_PAID } from "./order-state";

export async function requestReturn(userId: string, orderId: string, reasonRaw: string) {
  const reason = z.string().trim().min(10, "Tell us a little more (10+ characters)").max(1000).parse(reasonRaw);
  const [order, shop] = await Promise.all([prisma.order.findFirst({ where: { id: orderId, userId }, include: { returns: true } }), getShopSettings()]);
  if (!order) throw new AppError("Order not found.", 404);
  if (!LIVE_PAID.includes(order.status)) throw new AppError("This order can't be returned.");
  if (order.returns.some((r) => r.status === "REQUESTED" || r.status === "APPROVED")) throw new AppError("A return is already open for this order.");
  const from = order.deliveredAt ?? order.paidAt ?? order.createdAt;
  if (order.deliveredAt && Date.now() - from.getTime() > shop.returnWindowDays * 864e5) {
    throw new AppError(`Returns must be requested within ${shop.returnWindowDays} days of delivery.`);
  }
  const r = await prisma.returnRequest.create({ data: { orderId, userId, reason } });
  await audit("return.request", "ReturnRequest", r.id, userId, { orderId });
  return r;
}

/**
 * APPROVE = expect the item back; REFUND = refund now; REJECT = close.
 * Stock follows the restocking policy in inventory.ts: returned goods are restocked from the order page once inspected.
 */
export async function resolveReturn(id: string, action: "APPROVE" | "REFUND" | "REJECT", actorId: string, opts: { note?: string } = {}) {
  const r = await prisma.returnRequest.findUniqueOrThrow({ where: { id }, include: { order: true } });
  const allowed = { APPROVE: ["REQUESTED"], REFUND: ["REQUESTED", "APPROVED"], REJECT: ["REQUESTED", "APPROVED"] }[action];
  if (!allowed.includes(r.status)) throw new AppError(`This return is already ${r.status.toLowerCase()}.`);
  // REFUND refunds everything not yet refunded; for part of an order, use the refund form on the order page.
  if (action === "REFUND") {
    if (!LIVE_PAID.includes(r.order.status)) throw new AppError("This order has already been fully refunded.");
    await refundOrder(r.orderId, actorId, { reason: `Return: ${r.reason.slice(0, 200)}` });
  }
  const status = action === "APPROVE" ? "APPROVED" : action === "REFUND" ? "REFUNDED" : "REJECTED";
  await prisma.returnRequest.update({ where: { id }, data: { status, adminNote: opts.note || r.adminNote, resolvedById: actorId, resolvedAt: new Date() } });
  await notify(r.userId, `Return ${status.toLowerCase()}`, `Your return for order ${r.order.number} is ${status.toLowerCase()}.${opts.note ? ` ${opts.note}` : ""}`, `/orders/${r.orderId}`, undefined, "order");
  await audit(`return.${status.toLowerCase()}`, "ReturnRequest", id, actorId, { note: opts.note ?? null });
}
