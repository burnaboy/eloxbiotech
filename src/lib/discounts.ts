import type { DiscountCode } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import type { DiscountRule } from "./checkout-math";

/*
 * Discount codes are created by staff (Admin > Discounts) and checked here, on the server, every time a cart
 * is priced and again inside the order transaction. A code is "held" by an unpaid order and released if that
 * order is cancelled or expires, so usage limits can't be beaten by opening many checkouts at once.
 */

export function normaliseCode(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, "").slice(0, 40);
}

export function ruleOf(c: DiscountCode): DiscountRule {
  return { type: c.type, value: c.value, minSubtotalMinor: c.minSubtotalMinor, maxDiscountMinor: c.maxDiscountMinor };
}

/** Returns the code if it can be used by this customer for this subtotal, or a reason it can't. */
export async function checkCode(tx: Tx, rawCode: string, userId: string, subtotalMinor: number, now = new Date()): Promise<{ code: DiscountCode } | { error: string }> {
  const code = normaliseCode(rawCode);
  if (!code) return { error: "Enter a code." };
  const c = await tx.discountCode.findUnique({ where: { code } });
  if (!c || !c.active) return { error: "That code isn't valid." };
  if (c.startsAt && c.startsAt > now) return { error: "That code isn't active yet." };
  if (c.endsAt && c.endsAt <= now) return { error: "That code has expired." };
  if (c.maxRedemptions !== null && c.redeemedCount >= c.maxRedemptions) return { error: "That code has been fully used." };
  if (subtotalMinor < c.minSubtotalMinor) return { error: `That code needs a minimum spend.` };
  const used = await tx.discountRedemption.count({ where: { codeId: c.id, userId } });
  if (used >= c.perCustomerLimit) return { error: "You've already used that code." };
  return { code: c };
}

/**
 * Inside the order transaction: re-checks the code under a lock and records the redemption.
 * Throws if the code stopped being valid since the cart was shown.
 */
export async function redeemCode(tx: Tx, rawCode: string, userId: string, subtotalMinor: number, orderId: string, amountMinor: number) {
  const code = normaliseCode(rawCode);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`discount:${code}`}))`;
  const res = await checkCode(tx, code, userId, subtotalMinor);
  if ("error" in res) throw new AppError(`Discount code: ${res.error} Remove it to continue.`, 409);
  const c = res.code;
  const bumped = await tx.discountCode.updateMany({
    where: { id: c.id, ...(c.maxRedemptions !== null ? { redeemedCount: { lt: c.maxRedemptions } } : {}) },
    data: { redeemedCount: { increment: 1 } },
  });
  if (bumped.count === 0) throw new AppError("Discount code: it has just been fully used.", 409);
  await tx.discountRedemption.create({ data: { codeId: c.id, orderId, userId, amountMinor } });
  return c;
}

/** An unpaid order was cancelled or expired: give the use back. */
export async function releaseCode(tx: Tx, orderId: string) {
  const r = await tx.discountRedemption.findUnique({ where: { orderId } });
  if (!r) return;
  await tx.discountRedemption.delete({ where: { id: r.id } });
  await tx.discountCode.updateMany({ where: { id: r.codeId, redeemedCount: { gt: 0 } }, data: { redeemedCount: { decrement: 1 } } });
}

export async function findCodeForCart(userId: string, rawCode: string | undefined, subtotalMinor: number) {
  if (!rawCode) return null;
  return checkCode(prisma, rawCode, userId, subtotalMinor);
}
