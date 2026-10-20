import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { getBrand, getCompPlan, getOps, getShopSettings, type ShopSettings } from "./settings";
import { audit } from "./audit";
import { notify } from "./notify";
import { requireVerified } from "./email-verification";
import { unitPrice } from "./catalog";
import { reserveStock, returnStock } from "./inventory";
import { quote, type TaxRule } from "./checkout-math";
import { checkCode, normaliseCode, redeemCode, releaseCode, ruleOf } from "./discounts";
import { transitionOrder, STATUS_LABEL } from "./order-state";

export { shippingFor } from "./checkout-math";

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

export function taxRule(shop: ShopSettings): TaxRule {
  return { enabled: shop.taxEnabled, rateBps: shop.taxRateBps, included: shop.pricesIncludeTax, shipping: shop.taxShipping };
}

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
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > MAX_QTY) throw new AppError("Invalid quantity.");
  const qty = quantity;
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

/** Prices each cart line from the database. A line has a `problem` if the product or option was withdrawn or is short. */
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
    return { ...i, ...price, lineMinor: price.unitMinor * i.quantity, weightGrams: i.variant?.weightGrams ?? i.product.weightGrams, problem };
  });
}

/**
 * The cart with every total worked out on the server: subtotal, discount from an approved code, shipping,
 * VAT and the amount to pay. `code` is what the shopper typed; it is validated here every time.
 */
export async function getCart(userId: string, code?: string | null) {
  const [rows, shop] = await Promise.all([loadCartRows(prisma, userId), getShopSettings()]);
  const items = priceLines(rows);
  const subtotal = items.reduce((s, i) => s + i.lineMinor, 0);
  const check = code ? await checkCode(prisma, code, userId, subtotal) : null;
  const discount = check && "code" in check ? check.code : null;
  const q = quote(
    items.map((i) => ({ unitMinor: i.unitMinor, quantity: i.quantity, pv: i.pv, weightGrams: i.weightGrams, taxable: !i.product.taxExempt })),
    discount ? ruleOf(discount) : null,
    shop,
    taxRule(shop),
  );
  return {
    ...q,
    items: items.map((i, k) => ({ ...i, discountMinor: q.items[k].discountMinor, paidMinor: q.items[k].paidMinor, linePv: q.items[k].pv })),
    discountCode: discount?.code ?? null,
    discountDescription: discount?.description ?? null,
    discountError: check && "error" in check ? check.error : null,
    taxLabel: shop.taxLabel,
  };
}

// ---------- Checkout ----------

function orderNumber() {
  const d = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  return `NN${d}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

/**
 * Where an order's volume (PV) goes. A customer's order credits their sponsor's position. An affiliate's own
 * purchase credits their own position only when the plan allows it (binaryRetailOnly off); by default it
 * creates no volume, so team pay can't come from members buying for themselves.
 */
async function volumeNodeFor(tx: Tx, user: { role: string; node: { id: string } | null; sponsor: { node: { id: string } | null } | null }) {
  if (user.role === "CUSTOMER") return user.sponsor?.node?.id ?? null;
  const plan = await getCompPlan(tx);
  return plan.binaryRetailOnly ? null : (user.node?.id ?? user.sponsor?.node?.id ?? null);
}

/**
 * Turns the cart into a pending order. Prices, discount, shipping, VAT and PV are recomputed here from
 * product and code records; stock is reserved atomically. Fails without side effects if anything changed.
 *
 * `checkoutKey` is a one-time token from the checkout form. Submitting the same form twice (double click,
 * flaky network, back button) returns the order the first submission created instead of making another.
 */
export async function createOrderFromCart(userId: string, rawAddress: Address, opts: { checkoutKey?: string; discountCode?: string | null } = {}) {
  const address = addressSchema.parse(rawAddress);
  const key = opts.checkoutKey ? `${userId}:${z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).parse(opts.checkoutKey)}` : null;
  if (key) {
    const existing = await prisma.order.findUnique({ where: { checkoutKey: key } });
    if (existing) return existing;
  }
  const [shop, brand, ops] = await Promise.all([getShopSettings(), getBrand(), getOps()]);
  if (ops.checkoutPaused) throw new AppError("Checkout is temporarily paused. Please try again shortly.");

  try {
    return await prisma.$transaction(async (tx) => {
      // One checkout at a time per customer, so two tabs can't both turn the same cart into orders.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`checkout:${userId}`}))`;
      if (key) {
        const existing = await tx.order.findUnique({ where: { checkoutKey: key } });
        if (existing) return existing;
      }
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { node: true, sponsor: { include: { node: true } } } });
      requireVerified(user, "placing an order");
      const items = priceLines(await loadCartRows(tx, userId));
      if (!items.length) throw new AppError("Your cart is empty.");
      const bad = items.find((i) => i.problem);
      if (bad) throw new AppError(`${bad.product.name}: ${bad.problem}. Please update your cart.`, 409);

      const subtotal = items.reduce((s, i) => s + i.lineMinor, 0);
      const codeText = opts.discountCode ? normaliseCode(opts.discountCode) : null;
      let rule = null;
      if (codeText) {
        const res = await checkCode(tx, codeText, userId, subtotal);
        if ("error" in res) throw new AppError(`Discount code: ${res.error} Remove it to continue.`, 409);
        rule = ruleOf(res.code);
      }
      const q = quote(
        items.map((i) => ({ unitMinor: i.unitMinor, quantity: i.quantity, pv: i.pv, weightGrams: i.weightGrams, taxable: !i.product.taxExempt })),
        rule,
        shop,
        taxRule(shop),
      );
      if (q.totalMinor <= 0) throw new AppError("This order has nothing to pay. Please contact support.");

      const order = await tx.order.create({
        data: {
          number: orderNumber(),
          userId,
          checkoutKey: key,
          currency: brand.currency,
          subtotalMinor: q.subtotalMinor,
          discountMinor: q.discountMinor,
          discountCode: q.discountMinor > 0 ? codeText : null,
          shippingMinor: q.shippingMinor,
          taxMinor: q.taxMinor,
          taxRateBps: q.taxRateBps,
          taxIncluded: q.taxIncluded,
          totalMinor: q.totalMinor,
          totalPv: q.totalPv,
          volumeNodeId: await volumeNodeFor(tx, user),
          referrerId: user.sponsorId,
          ...address,
          shipLine2: address.shipLine2 || null,
          shipPostal: address.shipPostal || null,
          expiresAt: new Date(Date.now() + shop.orderExpiryMinutes * 60e3),
          items: {
            create: items.map((i, k) => ({
              productId: i.productId,
              variantId: i.variantId,
              name: i.product.name,
              variantName: i.variant?.name ?? null,
              sku: i.variant?.sku ?? i.product.sku,
              unitPriceMinor: i.unitMinor,
              listPriceMinor: i.compareAtMinor,
              pv: i.pv,
              quantity: i.quantity,
              discountMinor: q.items[k].discountMinor,
              taxMinor: q.items[k].taxMinor,
              netMinor: q.items[k].netMinor,
              paidMinor: q.items[k].paidMinor,
              commissionable: i.product.commissionable,
            })),
          },
        },
      });
      if (codeText && q.discountMinor > 0) await redeemCode(tx, codeText, userId, subtotal, order.id, q.discountMinor);
      for (const i of items) {
        await reserveStock(tx, { productId: i.productId, variantId: i.variantId, quantity: i.quantity }, order.id, i.variant ? `${i.product.name} (${i.variant.name})` : i.product.name);
      }
      await tx.cartItem.deleteMany({ where: { userId } });
      await audit("order.create", "Order", order.id, userId, { total: order.totalMinor, discount: order.discountMinor, tax: order.taxMinor }, tx);
      return order;
    });
  } catch (e) {
    // Lost a race with the same checkout key: return the order the other request made.
    if (key && e instanceof Error && (e as { code?: string }).code === "P2002") {
      const existing = await prisma.order.findUnique({ where: { checkoutKey: key } });
      if (existing) return existing;
    }
    throw e;
  }
}

// ---------- Cancellation and expiry ----------

async function releaseOrderStock(tx: Tx, orderId: string, actorId: string | null) {
  const items = await tx.orderItem.findMany({ where: { orderId } });
  for (const i of items) {
    await returnStock(tx, { productId: i.productId, variantId: i.variantId, quantity: i.quantity }, "RELEASE", { orderId, actorId });
  }
}

/** Cancels an unpaid order: its stock reservation and discount code use are released. */
export async function cancelPendingOrder(orderId: string, actorId: string | null, opts: { userId?: string; reason?: string } = {}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, ...(opts.userId ? { userId: opts.userId } : {}) }, select: { status: true } });
    if (!order) throw new AppError("Order not found.", 404);
    if (order.status !== "PENDING_PAYMENT") throw new AppError("Only unpaid orders can be cancelled.");
    await transitionOrder(tx, orderId, "CANCELLED", { cancelledAt: new Date(), cancelReason: opts.reason ?? (actorId ? "Cancelled" : "Payment not received in time") }, ["PENDING_PAYMENT"]);
    await releaseOrderStock(tx, orderId, actorId);
    await releaseCode(tx, orderId);
    // Open payment attempts stay PENDING so a late success can still be matched (see payments/service.ts).
    await audit("order.cancel", "Order", orderId, actorId, { reason: opts.reason ?? null }, tx);
  });
}

/** Cancels unpaid orders past their expiry and returns their stock. Safe to run repeatedly. */
export async function expireStaleOrders(now = new Date()) {
  const stale = await prisma.order.findMany({ where: { status: "PENDING_PAYMENT", expiresAt: { lt: now } }, select: { id: true } });
  let n = 0;
  for (const o of stale) {
    try {
      await cancelPendingOrder(o.id, null, { reason: "Payment not received in time" });
      n++;
    } catch {
      /* paid or cancelled meanwhile */
    }
  }
  return n;
}

// ---------- Fulfilment ----------

/**
 * PAID → PROCESSING → SHIPPED → DELIVERED. A partly refunded order keeps its status, and its shipping
 * progress is recorded in shippedAt / deliveredAt.
 */
export async function updateFulfilment(orderId: string, to: "PROCESSING" | "SHIPPED" | "DELIVERED", actorId: string, shipping: { carrier?: string; trackingRef?: string } = {}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.disputedAt && to !== "PROCESSING") throw new AppError("This order has an open payment dispute. Resolve it before shipping.");
    const now = new Date();
    const data =
      to === "PROCESSING" ? { processingAt: now }
      : to === "SHIPPED" ? { shippedAt: now, carrier: shipping.carrier || order.carrier, trackingRef: shipping.trackingRef || order.trackingRef }
      : { deliveredAt: now };
    if (order.status === "PARTIALLY_REFUNDED") {
      if (to === "PROCESSING") throw new AppError("This order is already being handled.");
      if (to === "SHIPPED" && order.shippedAt) throw new AppError("Already shipped.");
      if (to === "DELIVERED" && (!order.shippedAt || order.deliveredAt)) throw new AppError("Mark it shipped first.");
      await tx.order.updateMany({ where: { id: orderId, status: "PARTIALLY_REFUNDED" }, data });
    } else {
      await transitionOrder(tx, orderId, to, data);
    }
    if (to !== "PROCESSING") {
      const extra = to === "SHIPPED" && (shipping.carrier || shipping.trackingRef) ? ` ${[shipping.carrier, shipping.trackingRef].filter(Boolean).join(" · ")}` : "";
      await notify(order.userId, to === "SHIPPED" ? "Your order has shipped" : "Your order was delivered", `Order ${order.number} is ${STATUS_LABEL[to].toLowerCase()}.${extra}`, `/orders/${orderId}`, tx, "order");
    }
    await audit(`order.${to.toLowerCase()}`, "Order", orderId, actorId, shipping, tx);
  });
}
