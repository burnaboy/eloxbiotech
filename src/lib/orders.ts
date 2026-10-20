import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { OrderStatus, Prisma } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { getBrand, getOps, getShopSettings } from "./settings";
import { getProvider } from "./payments";
import type { PaymentEvent } from "./payments/types";
import { audit } from "./audit";
import { holdOrderCommissions, onOrderPaid, releaseOrderCommissions, reverseOrderCommissions } from "./commissions";
import { notify } from "./notify";
import { requireVerified } from "./email-verification";
import { unitPrice } from "./catalog";
import { reserveStock, returnStock } from "./inventory";

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

const cartInclude = {
  product: {
    include: {
      variants: { where: { active: true }, select: { id: true, active: true } },
      images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true, alt: true, width: true, height: true } },
    },
  },
  variant: true,
} as const;

/** Sets a cart line. Pass the variant for products that have variants. Prices are never taken from the client. */
export async function setCartQuantity(userId: string, productId: string, quantity: number, variantId: string | null = null) {
  const qty = Math.floor(quantity);
  if (!Number.isFinite(qty) || qty < 0 || qty > MAX_QTY) throw new AppError("Invalid quantity.");
  const variantKey = variantId ?? "";
  if (qty === 0) {
    await prisma.cartItem.deleteMany({ where: { userId, productId, variantKey } });
    return;
  }
  const product = await prisma.product.findUnique({ where: { id: productId }, include: { variants: { where: { active: true } } } });
  if (!product || product.status !== "ACTIVE") throw new AppError("This product is not available.");
  if (!product.shippable) throw new AppError("This product can't be delivered at the moment.");
  let available = product.stock;
  if (product.variants.length) {
    const v = product.variants.find((x) => x.id === variantId);
    if (!v) throw new AppError("Please choose an option.");
    available = v.stock;
  } else if (variantId) {
    throw new AppError("This product has no options.");
  }
  if (available < qty) throw new AppError(available === 0 ? "This item is out of stock." : `Only ${available} left in stock.`);
  await prisma.cartItem.upsert({
    where: { userId_productId_variantKey: { userId, productId, variantKey } },
    create: { userId, productId, variantId, variantKey, quantity: qty },
    update: { quantity: qty },
  });
}

export async function addToCart(userId: string, productId: string, quantity = 1, variantId: string | null = null) {
  const existing = await prisma.cartItem.findUnique({ where: { userId_productId_variantKey: { userId, productId, variantKey: variantId ?? "" } } });
  await setCartQuantity(userId, productId, (existing?.quantity ?? 0) + quantity, variantId);
}

type CartRow = Awaited<ReturnType<typeof loadCartRows>>[number];
function loadCartRows(tx: Tx, userId: string) {
  return tx.cartItem.findMany({ where: { userId }, include: cartInclude, orderBy: { createdAt: "asc" } });
}

/** Prices each cart line from the database. A line is unavailable if the product or option was withdrawn or is short. */
function priceLines(items: CartRow[], now = new Date()) {
  return items.map((i) => {
    const price = unitPrice(i.product, i.variant, now);
    const needsVariant = i.product.variants.length > 0;
    const variantOk = needsVariant ? !!i.variant?.active && i.product.variants.some((v) => v.id === i.variantId) : !i.variantId;
    const stock = i.variant ? i.variant.stock : i.product.stock;
    const problem =
      i.product.status !== "ACTIVE" ? "No longer available"
      : !i.product.shippable ? "Can't be delivered at the moment"
      : !variantOk ? "This option is no longer available"
      : stock < i.quantity ? (stock === 0 ? "Out of stock" : `Only ${stock} left`)
      : null;
    const weight = (i.variant?.weightGrams ?? i.product.weightGrams) * i.quantity;
    return { ...i, ...price, lineMinor: price.unitMinor * i.quantity, linePv: price.pv * i.quantity, weightGrams: weight, problem };
  });
}

export async function getCart(userId: string) {
  const [rows, shop] = await Promise.all([loadCartRows(prisma, userId), getShopSettings()]);
  const items = priceLines(rows);
  const subtotalMinor = items.reduce((s, i) => s + i.lineMinor, 0);
  const totalPv = items.reduce((s, i) => s + i.linePv, 0);
  const weightGrams = items.reduce((s, i) => s + i.weightGrams, 0);
  const shippingMinor = shippingFor(subtotalMinor, weightGrams, shop);
  return { items, subtotalMinor, shippingMinor, totalMinor: subtotalMinor + shippingMinor, totalPv, weightGrams };
}

/** Flat rate, plus an optional per-kilogram charge, free above the threshold. All integers. */
export function shippingFor(subtotal: number, weightGrams: number, shop: { flatShippingMinor: number; perKgShippingMinor?: number; freeShippingOverMinor: number }) {
  if (subtotal === 0) return 0;
  if (shop.freeShippingOverMinor > 0 && subtotal >= shop.freeShippingOverMinor) return 0;
  const kg = Math.ceil(Math.max(0, weightGrams) / 1000);
  return shop.flatShippingMinor + (shop.perKgShippingMinor ?? 0) * kg;
}

// ---------- Checkout ----------

function orderNumber() {
  const d = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  return `NN${d}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

/**
 * Turns the cart into an order. Prices, sale prices, PV and shipping are recomputed here from product records;
 * stock is reserved atomically. Fails without side effects if anything is short or has changed.
 */
export async function createOrderFromCart(userId: string, rawAddress: Address) {
  const address = addressSchema.parse(rawAddress);
  const [shop, brand, ops] = await Promise.all([getShopSettings(), getBrand(), getOps()]);
  if (ops.checkoutPaused) throw new AppError("Checkout is temporarily paused. Please try again shortly.");

  const order = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { node: true, sponsor: { include: { node: true } } } });
    requireVerified(user, "placing an order");
    const items = priceLines(await loadCartRows(tx, userId));
    if (!items.length) throw new AppError("Your cart is empty.");
    const bad = items.find((i) => i.problem);
    if (bad) throw new AppError(`${bad.product.name}: ${bad.problem}. Please update your cart.`, 409);

    const subtotalMinor = items.reduce((s, i) => s + i.lineMinor, 0);
    const shippingMinor = shippingFor(subtotalMinor, items.reduce((s, i) => s + i.weightGrams, 0), shop);
    const totalPv = items.reduce((s, i) => s + i.linePv, 0);

    const order = await tx.order.create({
      data: {
        number: orderNumber(),
        userId,
        currency: brand.currency,
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
            variantId: i.variantId,
            name: i.product.name,
            variantName: i.variant?.name ?? null,
            sku: i.variant?.sku ?? i.product.sku,
            unitPriceMinor: i.unitMinor,
            listPriceMinor: i.compareAtMinor,
            pv: i.pv,
            quantity: i.quantity,
          })),
        },
      },
    });
    for (const i of items) {
      await reserveStock(tx, { productId: i.productId, variantId: i.variantId, quantity: i.quantity }, order.id, i.variant ? `${i.product.name} (${i.variant.name})` : i.product.name);
    }
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
 * and each order transition only happens once.
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
    const order = payment.order;
    const raw = { ...event } as Prisma.InputJsonObject;

    switch (event.type) {
      case "payment.failed": {
        if (payment.status === "PENDING") await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", raw } });
        return { status: "failed" as const };
      }
      case "payment.succeeded": {
        if (event.amountMinor !== order.totalMinor || event.currency !== order.currency) {
          await tx.payment.update({ where: { id: payment.id }, data: { status: "FAILED", raw } });
          await audit("payment.amountMismatch", "Order", order.id, null, { event: raw }, tx);
          return { status: "amount_mismatch" as const };
        }
        await tx.payment.update({ where: { id: payment.id }, data: { status: "SUCCEEDED", raw } });
        const moved = await tx.order.updateMany({
          where: { id: order.id, status: "PENDING_PAYMENT" },
          data: { status: "PAID", paidAt: new Date() },
        });
        if (moved.count === 0) {
          // Paid after the order expired or was cancelled, or a second payment on one order: refund manually.
          await audit("payment.needsReview", "Order", order.id, null, { providerRef: event.providerRef, orderStatus: order.status }, tx);
          return { status: "needs_review" as const };
        }
        const paidOrder = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
        await onOrderPaid(tx, paidOrder);
        await notify(order.userId, "Payment received", `We've received payment for order ${order.number}.`, `/orders/${order.id}`, tx, "order");
        await audit("order.paid", "Order", order.id, null, { providerRef: event.providerRef }, tx);
        return { status: "paid" as const, orderId: order.id };
      }
      case "payment.refunded": {
        // Refund done in the gateway dashboard. If we started it ourselves the order is already REFUNDED.
        if (!PAID_STATES.includes(order.status)) return { status: "ignored" as const };
        await applyRefund(tx, order.id, null, { reason: "Refunded in payment gateway" });
        return { status: "refunded" as const };
      }
      case "dispute.opened": {
        await tx.order.update({ where: { id: order.id }, data: { disputedAt: order.disputedAt ?? new Date() } });
        await holdOrderCommissions(tx, order.id, "Payment dispute");
        await audit("order.disputeOpened", "Order", order.id, null, { providerRef: event.providerRef }, tx);
        return { status: "disputed" as const };
      }
      case "dispute.resolved": {
        if (event.merchantLost && PAID_STATES.includes(order.status)) {
          await applyRefund(tx, order.id, null, { reason: "Chargeback" });
          return { status: "charged_back" as const };
        }
        await tx.order.update({ where: { id: order.id }, data: { disputedAt: null } });
        await releaseOrderCommissions(tx, order.id);
        await audit("order.disputeWon", "Order", order.id, null, undefined, tx);
        return { status: "dispute_won" as const };
      }
    }
  });
}

/** Re-checks unpaid orders with the gateway, in case a webhook was missed. Run on a schedule. */
export async function reconcilePendingPayments(olderThanMinutes = 5) {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60e3);
  const pending = await prisma.payment.findMany({
    where: { status: "PENDING", createdAt: { lt: cutoff }, order: { status: { in: ["PENDING_PAYMENT", "CANCELLED"] } } },
    take: 200,
  });
  const results: Record<string, number> = {};
  for (const p of pending) {
    const provider = getProvider(p.provider);
    if (!provider.verify) continue;
    try {
      const e = await provider.verify(p.providerRef);
      if (!e) continue;
      const r = await applyPaymentEvent(provider.name, e);
      results[r.status] = (results[r.status] ?? 0) + 1;
    } catch {
      results.error = (results.error ?? 0) + 1;
    }
  }
  return results;
}

// ---------- Cancellation, expiry, fulfilment, refunds ----------

async function releaseStock(tx: Tx, orderId: string, reason: "RELEASE" | "REFUND", actorId: string | null) {
  const items = await tx.orderItem.findMany({ where: { orderId } });
  for (const i of items) {
    await returnStock(tx, { productId: i.productId, variantId: i.variantId, quantity: i.quantity }, reason, { orderId, actorId });
  }
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

export async function updateFulfilment(orderId: string, to: "SHIPPED" | "DELIVERED", actorId: string, shipping: { carrier?: string; trackingRef?: string } = {}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (!FLOW[order.status]?.includes(to)) throw new AppError(`Can't move an order from ${order.status} to ${to}.`);
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: to,
        carrier: shipping.carrier || order.carrier,
        trackingRef: shipping.trackingRef || order.trackingRef,
        ...(to === "SHIPPED" ? { shippedAt: new Date() } : { deliveredAt: new Date() }),
      },
    });
    await notify(order.userId, to === "SHIPPED" ? "Your order has shipped" : "Your order was delivered", `Order ${order.number} is ${to.toLowerCase()}.`, `/orders/${orderId}`, tx, "order");
    await audit(`order.${to.toLowerCase()}`, "Order", orderId, actorId, shipping, tx);
  });
}

const PAID_STATES: OrderStatus[] = ["PAID", "SHIPPED", "DELIVERED"];

/** Full refund started by an admin: refunds through the gateway, then updates our records. */
export async function refundOrder(orderId: string, actorId: string, opts: { reason?: string } = {}) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true } });
  if (!PAID_STATES.includes(order.status)) throw new AppError("Only paid orders can be refunded.");
  const paid = order.payments.find((p) => p.status === "SUCCEEDED");
  if (paid) await getProvider(paid.provider).refund(paid.providerRef, paid.amountMinor);
  await prisma.$transaction((tx) => applyRefund(tx, orderId, actorId, opts));
}

export { applyRefund };

/**
 * Marks an order refunded and reverses commissions/volume if already credited.
 * Restocking policy (see inventory.ts): an order that never shipped goes straight back to stock;
 * shipped goods return to stock only when staff record them as received and resellable.
 */
async function applyRefund(tx: Tx, orderId: string, actorId: string | null, opts: { reason?: string }) {
  const before = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  const moved = await tx.order.updateMany({ where: { id: orderId, status: { in: PAID_STATES } }, data: { status: "REFUNDED" } });
  if (moved.count === 0) throw new AppError("Order was already refunded.");
  await tx.payment.updateMany({ where: { orderId, status: "SUCCEEDED" }, data: { status: "REFUNDED" } });
  const restocked = !before.shippedAt;
  if (restocked) await releaseStock(tx, orderId, "REFUND", actorId);
  await reverseOrderCommissions(tx, orderId, actorId, opts.reason?.startsWith("Chargeback") ? "Chargeback" : "Refund");
  await notify(before.userId, "Order refunded", `Order ${before.number} has been refunded.`, `/orders/${orderId}`, tx, "order");
  await audit("order.refund", "Order", orderId, actorId, { restocked, awaitingReturn: !restocked, reason: opts.reason ?? null }, tx);
}
