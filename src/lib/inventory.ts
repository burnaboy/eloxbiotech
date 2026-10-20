import type { InventoryReason } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { audit } from "./audit";
import { notify } from "./notify";

/*
 * Every stock change goes through this file, and every change writes an InventoryMovement row.
 *
 * Stock means units available to sell. It is reserved (decremented) when an order is created, before payment,
 * with a conditional update so two shoppers can never buy the last unit twice. A database CHECK constraint
 * also refuses negative stock.
 *
 * Restocking policy
 *   - Unpaid order cancelled or expired: reserved units go straight back (RELEASE).
 *   - Paid order refunded before it shipped: the goods never left, so units go straight back (REFUND).
 *   - Refund or chargeback after shipping: nothing goes back automatically. Staff record the returned units
 *     once they arrive and are inspected: resellable units are restocked (RETURN_RESTOCK), the rest are
 *     written off (RETURN_WRITE_OFF, no stock change, kept for the audit trail).
 */

export interface StockLine {
  productId: string;
  variantId: string | null;
  quantity: number;
}

async function currentLevel(tx: Tx, line: Pick<StockLine, "productId" | "variantId">) {
  if (line.variantId) return (await tx.productVariant.findUniqueOrThrow({ where: { id: line.variantId }, select: { stock: true } })).stock;
  return (await tx.product.findUniqueOrThrow({ where: { id: line.productId }, select: { stock: true } })).stock;
}

async function record(tx: Tx, line: Pick<StockLine, "productId" | "variantId">, delta: number, reason: InventoryReason, extra: { orderId?: string | null; actorId?: string | null; note?: string | null }) {
  const balance = await currentLevel(tx, line);
  await tx.inventoryMovement.create({
    data: { productId: line.productId, variantId: line.variantId, delta, reason, balance, orderId: extra.orderId ?? null, actorId: extra.actorId ?? null, note: extra.note ?? null },
  });
  await checkLowStock(tx, line);
  return balance;
}

/** Takes units for an order. Throws if there isn't enough; the caller's transaction then rolls back everything. */
export async function reserveStock(tx: Tx, line: StockLine, orderId: string, label: string) {
  const res = line.variantId
    ? await tx.productVariant.updateMany({
        where: { id: line.variantId, productId: line.productId, active: true, stock: { gte: line.quantity }, product: { status: "ACTIVE" } },
        data: { stock: { decrement: line.quantity } },
      })
    : await tx.product.updateMany({
        where: { id: line.productId, status: "ACTIVE", stock: { gte: line.quantity } },
        data: { stock: { decrement: line.quantity } },
      });
  if (res.count === 0) throw new AppError(`Not enough stock for ${label}.`, 409);
  await record(tx, line, -line.quantity, "SALE", { orderId });
}

/** Puts units back (cancelled order, unshipped refund, inspected return). */
export async function returnStock(tx: Tx, line: StockLine, reason: "RELEASE" | "REFUND" | "RETURN_RESTOCK", extra: { orderId?: string; actorId?: string | null; note?: string } = {}) {
  if (line.quantity <= 0) return;
  if (line.variantId) {
    // A variant deleted since the order: fall back to the product's own stock.
    const v = await tx.productVariant.findUnique({ where: { id: line.variantId }, select: { id: true } });
    if (!v) line = { ...line, variantId: null };
  }
  if (line.variantId) await tx.productVariant.update({ where: { id: line.variantId }, data: { stock: { increment: line.quantity } } });
  else await tx.product.update({ where: { id: line.productId }, data: { stock: { increment: line.quantity } } });
  await record(tx, line, line.quantity, reason, extra);
}

/** Manual stock change by staff. A note is required so the history explains itself. */
export async function adjustStock(input: { productId: string; variantId: string | null; delta: number; reason: "RESTOCK" | "ADJUSTMENT"; note: string; actorId: string }) {
  const delta = Math.trunc(input.delta);
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 1_000_000) throw new AppError("Enter a non-zero whole number.");
  if (input.reason === "RESTOCK" && delta < 0) throw new AppError("A restock must add units. Use an adjustment to remove them.");
  const note = input.note.trim().slice(0, 300);
  if (note.length < 3) throw new AppError("Add a short note explaining the change.");
  return prisma.$transaction(async (tx) => {
    const line = { productId: input.productId, variantId: input.variantId };
    const res = line.variantId
      ? await tx.productVariant.updateMany({ where: { id: line.variantId, productId: line.productId, ...(delta < 0 ? { stock: { gte: -delta } } : {}) }, data: { stock: { increment: delta } } })
      : await tx.product.updateMany({ where: { id: line.productId, ...(delta < 0 ? { stock: { gte: -delta } } : {}) }, data: { stock: { increment: delta } } });
    if (res.count === 0) throw new AppError("Stock can't go below zero.");
    const balance = await record(tx, line, delta, input.reason, { actorId: input.actorId, note });
    await audit("inventory.adjust", "Product", input.productId, input.actorId, { variantId: input.variantId, delta, reason: input.reason, note, balance }, tx);
    return balance;
  });
}

/**
 * Records what came back after refunded items were returned: units fit to resell go back to stock,
 * the rest are written off. Each order line can only be accounted for once, up to its quantity.
 */
export async function receiveReturnedItems(orderId: string, lines: { orderItemId: string; restock: number; writeOff: number }[], actorId: string, note?: string) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    if (order.status !== "REFUNDED" && order.status !== "PARTIALLY_REFUNDED") throw new AppError("Record returned goods after the items have been refunded.");
    if (!order.shippedAt) throw new AppError("This order never shipped, so refunded units went back to stock at refund.");
    let any = false;
    for (const l of lines) {
      const item = order.items.find((i) => i.id === l.orderItemId);
      if (!item) throw new AppError("That item isn't on this order.");
      const restock = Math.max(0, Math.trunc(l.restock));
      const writeOff = Math.max(0, Math.trunc(l.writeOff));
      if (restock + writeOff === 0) continue;
      // Only refunded units can come back; units refunded before shipping were restocked at refund time.
      const open = item.refundedQty - item.restockedQty - item.writtenOffQty;
      if (restock + writeOff > open) throw new AppError(`Only ${open} unit(s) of ${item.name} are still unaccounted for.`);
      const moved = await tx.orderItem.updateMany({
        where: { id: item.id, restockedQty: item.restockedQty, writtenOffQty: item.writtenOffQty },
        data: { restockedQty: { increment: restock }, writtenOffQty: { increment: writeOff } },
      });
      if (moved.count === 0) throw new AppError("Someone else just updated this return. Reload and try again.", 409);
      const line = { productId: item.productId, variantId: item.variantId, quantity: restock };
      if (restock) await returnStock(tx, line, "RETURN_RESTOCK", { orderId, actorId, note });
      if (writeOff) await record(tx, { productId: item.productId, variantId: item.variantId }, 0, "RETURN_WRITE_OFF", { orderId, actorId, note: `${writeOff} unit(s) written off${note ? `: ${note}` : ""}` });
      any = true;
    }
    if (!any) throw new AppError("Enter at least one unit to restock or write off.");
    await audit("inventory.returnReceived", "Order", orderId, actorId, { lines, note: note ?? null }, tx);
  });
}

/**
 * Alerts staff once when stock falls to its threshold, and re-arms when it goes back above.
 * Recipients: super admins and admins with the PRODUCTS permission.
 */
export async function checkLowStock(tx: Tx, line: Pick<StockLine, "productId" | "variantId">) {
  const product = await tx.product.findUniqueOrThrow({ where: { id: line.productId }, select: { id: true, name: true, stock: true, lowStockThreshold: true, lowStockAlertedAt: true, status: true } });
  let level = product.stock;
  let threshold = product.lowStockThreshold;
  let alertedAt = product.lowStockAlertedAt;
  let label = product.name;
  const variant = line.variantId ? await tx.productVariant.findUnique({ where: { id: line.variantId } }) : null;
  if (variant) {
    level = variant.stock;
    threshold = variant.lowStockThreshold ?? product.lowStockThreshold;
    alertedAt = variant.lowStockAlertedAt;
    label = `${product.name} (${variant.name})`;
  }
  const low = level <= threshold;
  if (low && !alertedAt && product.status === "ACTIVE") {
    const set = { lowStockAlertedAt: new Date() };
    if (variant) await tx.productVariant.update({ where: { id: variant.id }, data: set });
    else await tx.product.update({ where: { id: product.id }, data: set });
    const staff = await tx.user.findMany({
      where: { status: "ACTIVE", OR: [{ role: "SUPER_ADMIN" }, { role: "ADMIN", adminPermissions: { has: "PRODUCTS" } }] },
      select: { id: true },
    });
    for (const s of staff) {
      await notify(s.id, level === 0 ? "Out of stock" : "Low stock", `${label} has ${level} left (alert level ${threshold}).`, `/admin/products/${product.id}`, tx, "account");
    }
    await audit("inventory.lowStock", "Product", product.id, null, { variantId: variant?.id ?? null, level, threshold }, tx);
  } else if (!low && alertedAt) {
    if (variant) await tx.productVariant.update({ where: { id: variant.id }, data: { lowStockAlertedAt: null } });
    else await tx.product.update({ where: { id: product.id }, data: { lowStockAlertedAt: null } });
  }
}
