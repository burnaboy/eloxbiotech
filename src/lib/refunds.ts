import type { Order, OrderItem, Prisma, Refund } from "@prisma/client";
import { z } from "zod";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { audit } from "./audit";
import { notify } from "./notify";
import { formatMoney } from "./money";
import { allocate, lineRefund } from "./checkout-math";
import { returnStock } from "./inventory";
import { LIVE_PAID, transitionOrder } from "./order-state";
import { adjustOrderCommissions } from "./commissions";
import { getProvider } from "./payments";
import { GatewayError } from "./payments/types";

/*
 * Refunds, full or partial.
 *
 * 1. The refund is recorded first, in one transaction: the Refund row, each line's refunded quantity and
 *    amount, the order's running totals and status (PARTIALLY_REFUNDED or REFUNDED), the stock policy, and
 *    the commission and volume recalculation. Nothing is applied twice: amounts are capped by what is left.
 * 2. Then the gateway is asked to return the money. If it refuses, the refund is marked FAILED and staff
 *    can retry it; if the call times out it stays PENDING until the gateway's webhook confirms it.
 *
 * Amounts per line come from what the customer actually paid for that line (after discount, with VAT),
 * so partial refunds add up exactly to the order total when everything has been refunded.
 *
 * Restocking: units refunded before the order shipped go straight back to stock. Units refunded after
 * shipping return to stock only when staff record them as received and resellable (inventory.ts).
 */

export const refundInputSchema = z.object({
  reason: z.string().trim().min(3, "Give a reason").max(300),
  /** Omit for a full refund of everything not yet refunded. */
  lines: z.array(z.object({ orderItemId: z.string().min(1), quantity: z.number().int().min(0).max(999) })).optional(),
  /** Partial refunds: also refund the delivery charge that hasn't been refunded yet. */
  shipping: z.boolean().optional(),
});
export type RefundInput = z.input<typeof refundInputSchema>;

type Plan = { items: { item: OrderItem; quantity: number; paidMinor: number; netMinor: number }[]; shippingMinor: number; amountMinor: number };

/** What is left to refund on the delivery charge (charged amount including any VAT added on top). */
export function shippingRemaining(order: Pick<Order, "totalMinor" | "refundedMinor">, items: Pick<OrderItem, "paidMinor" | "refundedMinor">[]) {
  const shippingPaid = order.totalMinor - items.reduce((s, i) => s + i.paidMinor, 0);
  const shippingRefunded = order.refundedMinor - items.reduce((s, i) => s + i.refundedMinor, 0);
  return Math.max(0, shippingPaid - shippingRefunded);
}

/** Pure: a refund of whole units (plus optionally the remaining delivery charge). */
export function planUnitRefund(order: Pick<Order, "totalMinor" | "refundedMinor">, items: OrderItem[], lines: { orderItemId: string; quantity: number }[] | undefined, withShipping: boolean): Plan {
  const full = !lines;
  const wanted = full ? items.map((i) => ({ orderItemId: i.id, quantity: i.quantity - i.refundedQty })) : lines;
  const out: Plan["items"] = [];
  for (const l of wanted) {
    if (l.quantity <= 0) continue;
    const item = items.find((i) => i.id === l.orderItemId);
    if (!item) throw new AppError("That item isn't on this order.");
    if (item.refundedQty + l.quantity > item.quantity) throw new AppError(`Only ${item.quantity - item.refundedQty} unit(s) of ${item.name} are left to refund.`);
    const r = lineRefund(item, l.quantity);
    out.push({ item, quantity: l.quantity, ...r });
  }
  const shippingMinor = full || withShipping ? shippingRemaining(order, items) : 0;
  return { items: out, shippingMinor, amountMinor: out.reduce((s, i) => s + i.paidMinor, 0) + shippingMinor };
}

/**
 * Pure: a refund of an amount with no units given (a refund made in the gateway dashboard, or a chargeback).
 * The amount is spread over what is left on each line and the delivery charge, in proportion.
 */
export function planAmountRefund(order: Pick<Order, "totalMinor" | "refundedMinor">, items: OrderItem[], amountMinor: number): Plan {
  const remaining = order.totalMinor - order.refundedMinor;
  if (amountMinor >= remaining) return planUnitRefund(order, items, undefined, true);
  const ship = shippingRemaining(order, items);
  const left = items.map((i) => i.paidMinor - i.refundedMinor);
  const parts = allocate(amountMinor, [...left, ship]);
  const out: Plan["items"] = [];
  items.forEach((item, k) => {
    const paid = parts[k];
    if (paid <= 0) return;
    const netLeft = item.netMinor - item.refundedNetMinor;
    const net = paid >= left[k] ? netLeft : Number((BigInt(netLeft) * BigInt(paid)) / BigInt(left[k]));
    out.push({ item, quantity: 0, paidMinor: paid, netMinor: net });
  });
  return { items: out, shippingMinor: parts[items.length], amountMinor };
}

/** PV refunded on a line: whole units refunded, or the refunded share of its value if that is more. */
function refundedPvOf(i: Pick<OrderItem, "pv" | "quantity" | "refundedQty" | "netMinor" | "refundedNetMinor">) {
  const byUnits = i.pv * i.refundedQty;
  const byValue = i.netMinor > 0 ? Number((BigInt(i.pv * i.quantity) * BigInt(i.refundedNetMinor)) / BigInt(i.netMinor)) : 0;
  return Math.min(i.pv * i.quantity, Math.max(byUnits, byValue));
}

/**
 * Records a refund against an order inside `tx`. The caller holds no lock; this takes the order row lock.
 * Returns the Refund row.
 */
export async function recordRefund(
  tx: Tx,
  orderId: string,
  how: { units: { lines?: { orderItemId: string; quantity: number }[]; shipping?: boolean } } | { amountMinor: number },
  meta: { reason: string; actorId: string | null; source: string; status: "PENDING" | "PROCESSED"; providerRefundId?: string | null; paymentId: string | null },
): Promise<Refund> {
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: { orderBy: { id: "asc" } } } });
  if (!LIVE_PAID.includes(order.status)) throw new AppError("Only paid orders that aren't fully refunded can be refunded.");
  const remaining = order.totalMinor - order.refundedMinor;
  const plan = "amountMinor" in how ? planAmountRefund(order, order.items, how.amountMinor) : planUnitRefund(order, order.items, how.units.lines, !!how.units.shipping);
  if (plan.amountMinor <= 0) throw new AppError("Choose at least one item or the delivery charge to refund.");
  if (plan.amountMinor > remaining) throw new AppError(`At most ${formatMoney(remaining, order.currency)} is left to refund.`);

  const now = new Date();
  for (const p of plan.items) {
    const restockNow = !order.shippedAt && p.quantity > 0;
    const moved = await tx.orderItem.updateMany({
      where: { id: p.item.id, refundedQty: p.item.refundedQty, refundedMinor: p.item.refundedMinor },
      data: {
        refundedQty: { increment: p.quantity },
        refundedMinor: { increment: p.paidMinor },
        refundedNetMinor: { increment: p.netMinor },
        ...(restockNow ? { restockedQty: { increment: p.quantity } } : {}),
      },
    });
    if (moved.count === 0) throw new AppError("This order was just updated. Reload and try again.", 409);
    if (restockNow) await returnStock(tx, { productId: p.item.productId, variantId: p.item.variantId, quantity: p.quantity }, "REFUND", { orderId, actorId: meta.actorId });
  }
  const items = await tx.orderItem.findMany({ where: { orderId } });
  const refundedMinor = order.refundedMinor + plan.amountMinor;
  const full = refundedMinor === order.totalMinor;
  const refundedPv = full ? order.totalPv : Math.min(order.totalPv, items.reduce((s, i) => s + refundedPvOf(i), 0));
  await transitionOrder(tx, orderId, full ? "REFUNDED" : "PARTIALLY_REFUNDED", { refundedMinor, refundedPv }, [order.status]);

  if (meta.paymentId) {
    const pay = await tx.payment.findUniqueOrThrow({ where: { id: meta.paymentId } });
    const paid = pay.refundedMinor + plan.amountMinor;
    if (paid > pay.amountMinor) throw new AppError("That is more than was paid.");
    await tx.payment.update({ where: { id: pay.id }, data: { refundedMinor: paid, status: paid === pay.amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
  }
  const lines = plan.items.map((p) => ({ orderItemId: p.item.id, name: p.item.name, quantity: p.quantity, amountMinor: p.paidMinor, netMinor: p.netMinor }));
  const refund = await tx.refund.create({
    data: {
      orderId,
      paymentId: meta.paymentId,
      amountMinor: plan.amountMinor,
      status: meta.status,
      providerRefundId: meta.providerRefundId ?? null,
      reason: meta.reason,
      lines: { lines, shippingMinor: plan.shippingMinor } as unknown as Prisma.InputJsonObject,
      source: meta.source,
      actorId: meta.actorId,
      processedAt: meta.status === "PROCESSED" ? now : null,
    },
  });
  await adjustOrderCommissions(tx, orderId, meta.actorId, meta.source === "chargeback" ? "Chargeback" : full ? "Refund" : "Partial refund", `refund:${refund.id}`);
  await notify(order.userId, full ? "Order refunded" : "Part of your order was refunded", `${formatMoney(plan.amountMinor, order.currency)} was refunded on order ${order.number}.`, `/orders/${orderId}`, tx, "order");
  await audit("order.refund", "Order", orderId, meta.actorId, { refundId: refund.id, amountMinor: plan.amountMinor, full, source: meta.source, reason: meta.reason, lines, shippingMinor: plan.shippingMinor, restocked: !order.shippedAt, privileged: true }, tx);
  return refund;
}

/** The payment that paid the order, which refunds go back to. */
async function paidPayment(tx: Tx, order: Pick<Order, "id" | "paidPaymentId">) {
  if (!order.paidPaymentId) throw new AppError("This order has no recorded payment to refund.");
  return tx.payment.findUniqueOrThrow({ where: { id: order.paidPaymentId } });
}

/** Staff refund: records it, then asks the gateway to send the money back. */
export async function refundOrder(orderId: string, actorId: string, raw: RefundInput) {
  const input = refundInputSchema.parse(raw);
  const refund = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.disputedAt) throw new AppError("This order has an open payment dispute. Wait for the dispute to be resolved.");
    const payment = await paidPayment(tx, order);
    return recordRefund(tx, orderId, { units: { lines: input.lines, shipping: input.shipping } }, { reason: input.reason, actorId, source: "admin", status: "PENDING", paymentId: payment.id });
  });
  return sendRefund(refund.id, actorId);
}

/**
 * Asks the gateway to pay a recorded refund. Returns the refund with its new status.
 * A refusal marks it FAILED (staff can retry); a timeout leaves it PENDING for the webhook to confirm,
 * because retrying blindly could refund twice.
 */
export async function sendRefund(refundId: string, actorId: string | null) {
  const claim = await prisma.refund.updateMany({ where: { id: refundId, providerRefundId: null, OR: [{ status: "FAILED" }, { status: "PENDING", attempts: 0 }] }, data: { attempts: { increment: 1 }, status: "PENDING", failureReason: null } });
  if (claim.count === 0) throw new AppError("This refund has already been sent to the payment provider.");
  const refund = await prisma.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true } });
  if (!refund.payment) throw new AppError("This refund isn't linked to a payment.");
  const provider = getProvider(refund.payment.provider);
  try {
    const r = await provider.refund(refund.payment.providerRef, refund.amountMinor, refund.id);
    const updated = await prisma.refund.update({
      where: { id: refundId },
      data: { providerRefundId: r.refundId ?? null, status: r.status === "processed" ? "PROCESSED" : "PENDING", processedAt: r.status === "processed" ? new Date() : null },
    });
    await audit("refund.sent", "Refund", refundId, actorId, { providerRefundId: r.refundId ?? null, status: r.status });
    return updated;
  } catch (e) {
    const definite = e instanceof GatewayError && e.definite;
    const message = e instanceof Error ? e.message : "Unknown error";
    const updated = await prisma.refund.update({
      where: { id: refundId },
      data: definite
        ? { status: "FAILED", failureReason: message.slice(0, 300) }
        : { failureReason: `Not confirmed: ${message}`.slice(0, 300) },
    });
    await audit(definite ? "refund.failed" : "refund.unconfirmed", "Refund", refundId, actorId, { error: message });
    return updated;
  }
}

/** Retries a refund the gateway refused. */
export async function retryRefund(refundId: string, actorId: string) {
  const r = await prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
  if (r.status !== "FAILED") throw new AppError("Only failed refunds can be retried. A pending refund is waiting for the payment provider.");
  return sendRefund(refundId, actorId);
}

/**
 * Gives back an extra payment: a second successful payment on an order that was already paid, or a payment
 * that arrived after the order had been cancelled. The order itself is not changed.
 */
export async function refundExtraPayment(paymentId: string, actorId: string, reason: string) {
  const refund = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { order: true } });
    if (p.order.paidPaymentId === p.id) throw new AppError("This payment paid the order. Refund the order instead.");
    if (p.status !== "SUCCEEDED") throw new AppError("Only successful payments can be given back.");
    const amountMinor = p.amountMinor - p.refundedMinor;
    await tx.payment.update({ where: { id: p.id }, data: { refundedMinor: p.amountMinor, status: "REFUNDED" } });
    const r = await tx.refund.create({ data: { orderId: p.orderId, paymentId: p.id, amountMinor, reason: reason.trim().slice(0, 300) || "Extra payment returned", source: "extra-payment", actorId, lines: { lines: [], shippingMinor: 0 } } });
    await audit("payment.extraRefund", "Payment", p.id, actorId, { refundId: r.id, amountMinor, privileged: true }, tx);
    return r;
  });
  return sendRefund(refund.id, actorId);
}
