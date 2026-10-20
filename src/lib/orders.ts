import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { OrderStatus } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { CURRENCY } from "./money";
import { getShopSettings } from "./settings";
import { getProvider } from "./payments";
import type { PaymentEvent } from "./payments/types";
import { audit } from "./audit";
import { reverseOrderCommissions } from "./commissions";

export const MAX_QTY = 99;

export const addressSchema = z.object({
  shipName: z.string().trim().min(2).max(100),
  shipPhone: z.string().trim().min(5).max(30),
  shipLine1: z.string().trim().min(3).max(200),
  shipLine2: z.string().trim().max(200).optional().or(z.literal("")),
  shipCity: z.string().trim().min(2).max(100),
  shipState: z.string().trim().min(2).max(100),
  shipCountry: z.string().trim().min(2).max(100),
  shipPostal: z.string().trim().max(20).optional().or(z.literal("")),
});
export type Address = z.infer<typeof addressSchema>;

// ---------- Cart ----------

export async function setCartQuantity(userId: string, productId: string, quantity: number) {
  const qty = Math.floor(quantity);
  if (!Number.isFinite(qty) || qty < 0 || qty > MAX_QTY) throw new AppError("Invalid quantity.");
  if (qty === 0) {
    await prisma.cartItem.deleteMany({ where: { userId, productId } });
    return;
  }
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || !product.active) throw new AppError("This product is not available.");
  if (product.stock < qty) throw new AppError(`Only ${product.stock} left in stock.`);
  await prisma.cartItem.upsert({
    where: { userId_productId: { userId, productId } },
    create: { userId, productId, quantity: qty },
    update: { quantity: qty },
  });
}

export async function addToCart(userId: string, productId: string, quantity = 1) {
  const existing = await prisma.cartItem.findUnique({ where: { userId_productId: { userId, productId } } });
  await setCartQuantity(userId, productId, (existing?.quantity ?? 0) + quantity);
}

export async function getCart(userId: string) {
  const items = await prisma.cartItem.findMany({ where: { userId }, include: { product: true }, orderBy: { createdAt: "asc" } });
  const shop = await getShopSettings();
  const subtotalMinor = items.reduce((s, i) => s + i.product.priceMinor * i.quantity, 0);
  const totalPv = items.reduce((s, i) => s + i.product.pv * i.quantity, 0);
  const shippingMinor = shippingFor(subtotalMinor, shop);
  return { items, subtotalMinor, shippingMinor, totalMinor: subtotalMinor + shippingMinor, totalPv };
}

function shippingFor(subtotal: number, shop: { flatShippingMinor: number; freeShippingOverMinor: number }) {
  if (subtotal === 0) return 0;
  if (shop.freeShippingOverMinor > 0 && subtotal >= shop.freeShippingOverMinor) return 0;
  return shop.flatShippingMinor;
}

// ---------- Checkout ----------

function orderNumber() {
  const d = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  return `NN${d}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

/** Turns the cart into an order, reserving stock atomically. Fails without side effects if anything is short. */
export async function createOrderFromCart(userId: string, rawAddress: Address) {
  const address = addressSchema.parse(rawAddress);
  const shop = await getShopSettings();

  const order = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { node: true, sponsor: { include: { node: true } } } });
    const items = await tx.cartItem.findMany({ where: { userId }, include: { product: true } });
    if (!items.length) throw new AppError("Your cart is empty.");

    for (const item of items) {
      const res = await tx.product.updateMany({
        where: { id: item.productId, active: true, stock: { gte: item.quantity } },
        data: { stock: { decrement: item.quantity } },
      });
      if (res.count === 0) throw new AppError(`Not enough stock for ${item.product.name}.`, 409);
    }

    const subtotalMinor = items.reduce((s, i) => s + i.product.priceMinor * i.quantity, 0);
    const shippingMinor = shippingFor(subtotalMinor, shop);
    const totalPv = items.reduce((s, i) => s + i.product.pv * i.quantity, 0);

    const order = await tx.order.create({
      data: {
        number: orderNumber(),
        userId,
        currency: CURRENCY,
        subtotalMinor,
        shippingMinor,
        totalMinor: subtotalMinor + shippingMinor,
        totalPv,
        volumeNodeId: user.node?.id ?? user.sponsor?.node?.id ?? null,
        referrerId: user.sponsorId,
        ...address,
        shipLine2: address.shipLine2 || null,
        shipPostal: address.shipPostal || null,
        expiresAt: new Date(Date.now() + shop.orderExpiryMinutes * 60e3),
        items: {
          create: items.map((i) => ({
            productId: i.productId,
            name: i.product.name,
            sku: i.product.sku,
            unitPriceMinor: i.product.priceMinor,
            pv: i.product.pv,
            quantity: i.quantity,
          })),
        },
      },
    });
    await tx.inventoryMovement.createMany({
      data: items.map((i) => ({ productId: i.productId, delta: -i.quantity, reason: "SALE" as const, orderId: order.id })),
    });
    await tx.cartItem.deleteMany({ where: { userId } });
    await audit("order.create", "Order", order.id, userId, { total: order.totalMinor }, tx);
    return order;
  });

  return order;
}

/** Starts (or restarts) payment for a pending order and returns where to send the buyer. */
export async function startPayment(orderId: string, userId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, include: { user: true } });
  if (!order) throw new AppError("Order not found.", 404);
  if (order.status !== "PENDING_PAYMENT") throw new AppError("This order is not awaiting payment.");
  if (order.expiresAt < new Date()) throw new AppError("This order has expired. Please check out again.");
  const provider = getProvider();
  const { providerRef, redirectUrl } = await provider.createCheckout({
    orderId: order.id,
    orderNumber: order.number,
    amountMinor: order.totalMinor,
    currency: order.currency,
    email: order.user.email,
  });
  await prisma.payment.create({
    data: { orderId: order.id, provider: provider.name, providerRef, amountMinor: order.totalMinor, currency: order.currency },
  });
  return redirectUrl;
}

/**
 * Applies a verified gateway event. Idempotent: replays of the same event id are ignored,
 * and the order only moves PENDING_PAYMENT -> PAID once.
 */
export async function applyPaymentEvent(providerName: string, event: PaymentEvent) {
  return prisma.$transaction(async (tx) => {
    try {
      await tx.webhookEvent.create({ data: { provider: providerName, eventId: event.eventId, type: event.type } });
    } catch {
      return { status: "duplicate" as const };
    }
    const payment = await tx.payment.findUnique({ where: { providerRef: event.providerRef }, include: { order: true } });
    if (!payment || payment.provider !== providerName) return { status: "unknown_payment" as const };

    if (event.type === "payment.failed") {
      await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", raw: event as object } });
      return { status: "failed" as const };
    }

    if (event.amountMinor !== payment.order.totalMinor || event.currency !== payment.order.currency) {
      await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", raw: event as object } });
      await audit("payment.amountMismatch", "Order", payment.orderId, null, { event: event as object }, tx);
      return { status: "amount_mismatch" as const };
    }

    await tx.payment.update({ where: { id: payment.id }, data: { status: "SUCCEEDED", raw: event as object } });
    const moved = await tx.order.updateMany({
      where: { id: payment.orderId, status: "PENDING_PAYMENT" },
      data: { status: "PAID", paidAt: new Date() },
    });
    if (moved.count === 0) {
      // Paid after the order expired or was cancelled: flag for a manual refund.
      await audit("payment.lateOrDuplicate", "Order", payment.orderId, null, { providerRef: event.providerRef, status: payment.order.status }, tx);
      return { status: "needs_review" as const };
    }
    await audit("order.paid", "Order", payment.orderId, null, { providerRef: event.providerRef }, tx);
    return { status: "paid" as const, orderId: payment.orderId };
  });
}

// ---------- Cancellation, expiry, fulfilment, refunds ----------

async function releaseStock(tx: Tx, orderId: string, reason: "RELEASE" | "REFUND", actorId: string | null) {
  const items = await tx.orderItem.findMany({ where: { orderId } });
  for (const i of items) {
    await tx.product.update({ where: { id: i.productId }, data: { stock: { increment: i.quantity } } });
  }
  await tx.inventoryMovement.createMany({
    data: items.map((i) => ({ productId: i.productId, delta: i.quantity, reason, orderId, actorId })),
  });
}

export async function cancelPendingOrder(orderId: string, actorId: string | null, opts: { userId?: string } = {}) {
  return prisma.$transaction(async (tx) => {
    const moved = await tx.order.updateMany({
      where: { id: orderId, status: "PENDING_PAYMENT", ...(opts.userId ? { userId: opts.userId } : {}) },
      data: { status: "CANCELLED" },
    });
    if (moved.count === 0) throw new AppError("Only unpaid orders can be cancelled.");
    await releaseStock(tx, orderId, "RELEASE", actorId);
    await audit("order.cancel", "Order", orderId, actorId, undefined, tx);
  });
}

/** Cancels unpaid orders past their expiry and returns their stock. Safe to run repeatedly. */
export async function expireStaleOrders(now = new Date()) {
  const stale = await prisma.order.findMany({ where: { status: "PENDING_PAYMENT", expiresAt: { lt: now } }, select: { id: true } });
  let n = 0;
  for (const o of stale) {
    try {
      await cancelPendingOrder(o.id, null);
      n++;
    } catch {
      /* paid or cancelled meanwhile */
    }
  }
  return n;
}

const FLOW: Partial<Record<OrderStatus, OrderStatus[]>> = { PAID: ["SHIPPED"], SHIPPED: ["DELIVERED"] };

export async function updateFulfilment(orderId: string, to: "SHIPPED" | "DELIVERED", actorId: string, trackingRef?: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (!FLOW[order.status]?.includes(to)) throw new AppError(`Can't move an order from ${order.status} to ${to}.`);
    await tx.order.update({ where: { id: orderId }, data: { status: to, trackingRef: trackingRef || order.trackingRef } });
    await audit(`order.${to.toLowerCase()}`, "Order", orderId, actorId, { trackingRef }, tx);
  });
}

/** Full refund. Restocks if asked, and reverses any commissions and volume already credited. */
export async function refundOrder(orderId: string, actorId: string, opts: { restock: boolean; reason?: string }) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
  if (!["PAID", "SHIPPED", "DELIVERED"].includes(order.status)) throw new AppError("Only paid orders can be refunded.");
  const paid = order.payments.find((p) => p.status === "SUCCEEDED");
  if (paid) await getProvider(paid.provider).refund(paid.providerRef, paid.amountMinor);

  await prisma.$transaction(async (tx) => {
    const moved = await tx.order.updateMany({
      where: { id: orderId, status: { in: ["PAID", "SHIPPED", "DELIVERED"] } },
      data: { status: "REFUNDED" },
    });
    if (moved.count === 0) throw new AppError("Order was already refunded.");
    if (paid) await tx.payment.update({ where: { id: paid.id }, data: { status: "REFUNDED" } });
    if (opts.restock) await releaseStock(tx, orderId, "REFUND", actorId);
    if (order.commissionedAt) await reverseOrderCommissions(tx, order.id, actorId);
    await audit("order.refund", "Order", orderId, actorId, { restock: opts.restock, reason: opts.reason ?? null }, tx);
  });
}
