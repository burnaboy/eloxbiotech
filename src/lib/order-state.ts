import type { OrderStatus, Prisma } from "@prisma/client";
import type { Tx } from "./db";
import { AppError } from "./errors";

/*
 * Order state machine. Every status change goes through `transitionOrder`, which only moves an order
 * along an allowed edge and does it with a conditional update, so two processes can't both move it.
 *
 *   PENDING_PAYMENT ──paid──▶ PAID ──▶ PROCESSING ──▶ SHIPPED ──▶ DELIVERED
 *        │                     │           │             │           │
 *        └──▶ CANCELLED        └───────────┴──── refunds ┴───────────┘
 *             (unpaid only)                       ▼
 *                                  PARTIALLY_REFUNDED ──▶ REFUNDED
 *
 * A paid order never goes back to PENDING_PAYMENT or CANCELLED, whatever order gateway events arrive in.
 * A partly refunded order keeps shipping: shippedAt / deliveredAt record fulfilment from then on.
 */

export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING_PAYMENT: ["PAID", "CANCELLED"],
  PAID: ["PROCESSING", "SHIPPED", "PARTIALLY_REFUNDED", "REFUNDED"],
  PROCESSING: ["SHIPPED", "PARTIALLY_REFUNDED", "REFUNDED"],
  SHIPPED: ["DELIVERED", "PARTIALLY_REFUNDED", "REFUNDED"],
  DELIVERED: ["PARTIALLY_REFUNDED", "REFUNDED"],
  PARTIALLY_REFUNDED: ["PARTIALLY_REFUNDED", "REFUNDED"],
  CANCELLED: [],
  REFUNDED: [],
};

/** Paid and not fully refunded: these orders count for commissions, volume and fulfilment. */
export const LIVE_PAID: OrderStatus[] = ["PAID", "PROCESSING", "SHIPPED", "DELIVERED", "PARTIALLY_REFUNDED"];
/** Statuses where money was received at some point. */
export const EVER_PAID: OrderStatus[] = [...LIVE_PAID, "REFUNDED"];

export function canTransition(from: OrderStatus, to: OrderStatus) {
  return TRANSITIONS[from].includes(to);
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  PAID: "Paid",
  PROCESSING: "Processing",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partly refunded",
};

/**
 * Moves an order from one of `from` to `to`. Throws if the order isn't in an allowed state
 * or if another process changed it first. Returns the status it moved from.
 */
export async function transitionOrder(tx: Tx, orderId: string, to: OrderStatus, data: Prisma.OrderUncheckedUpdateManyInput = {}, from?: OrderStatus[]) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
  const allowedFrom = (from ?? (Object.keys(TRANSITIONS) as OrderStatus[])).filter((s) => canTransition(s, to));
  if (!allowedFrom.includes(order.status)) {
    throw new AppError(`This order is ${STATUS_LABEL[order.status].toLowerCase()} and can't be moved to ${STATUS_LABEL[to].toLowerCase()}.`, 409);
  }
  const moved = await tx.order.updateMany({ where: { id: orderId, status: order.status }, data: { ...data, status: to } });
  if (moved.count === 0) throw new AppError("This order was just updated by someone else. Please reload.", 409);
  return order.status;
}
