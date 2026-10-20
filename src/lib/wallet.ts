import { z } from "zod";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { getOps, getShopSettings } from "./settings";
import { audit } from "./audit";
import { notify } from "./notify";
import { requireVerified } from "./email-verification";

/** Balance is a ledger: approved + paid commissions minus every payout that wasn't rejected. */
export async function walletBalance(userId: string, tx: Tx = prisma) {
  const [byStatus, paidOut] = await Promise.all([
    tx.commission.groupBy({ by: ["status"], where: { userId }, _sum: { amountMinor: true } }),
    tx.payout.aggregate({ where: { userId, status: { not: "REJECTED" } }, _sum: { amountMinor: true } }),
  ]);
  const sum = (s: string) => byStatus.find((r) => r.status === s)?._sum.amountMinor ?? 0;
  const earned = sum("APPROVED") + sum("PAID");
  const withdrawn = paidOut._sum.amountMinor ?? 0;
  return { earnedMinor: earned, withdrawnMinor: withdrawn, availableMinor: earned - withdrawn, pendingMinor: sum("PENDING"), heldMinor: sum("HELD") };
}

export const payoutSchema = z.object({
  amountMinor: z.number().int().positive(),
  method: z.enum(["BANK_TRANSFER", "MOBILE_MONEY"]),
  destination: z.string().trim().min(4).max(200),
});

export async function requestPayout(userId: string, raw: z.input<typeof payoutSchema>) {
  const input = payoutSchema.parse(raw);
  const [shop, ops] = await Promise.all([getShopSettings(), getOps()]);
  if (ops.payoutsPaused) throw new AppError("Payouts are temporarily paused. Please try again later.");
  if (input.amountMinor < shop.minPayoutMinor) throw new AppError("Amount is below the minimum payout.");
  requireVerified(await prisma.user.findUniqueOrThrow({ where: { id: userId } }), "requesting a payout");
  return prisma.$transaction(async (tx) => {
    // One payout request at a time per user, so two requests can't both spend the same balance.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const { availableMinor } = await walletBalance(userId, tx);
    if (input.amountMinor > availableMinor) throw new AppError("Amount is more than your available balance.");
    const payout = await tx.payout.create({ data: { userId, ...input } });
    await audit("payout.request", "Payout", payout.id, userId, { amountMinor: input.amountMinor }, tx);
    return payout;
  });
}

/** Marks approved commissions as paid, oldest first, to cover a completed payout. */
async function allocatePayout(tx: Tx, userId: string, amountMinor: number) {
  let pool = amountMinor;
  const negatives = await tx.commission.findMany({ where: { userId, status: "APPROVED", amountMinor: { lt: 0 } } });
  for (const n of negatives) {
    pool += -n.amountMinor;
    await tx.commission.update({ where: { id: n.id }, data: { status: "PAID", paidMinor: n.amountMinor } });
  }
  const open = await tx.commission.findMany({ where: { userId, status: "APPROVED", amountMinor: { gt: 0 } }, orderBy: { approvedAt: "asc" } });
  for (const c of open) {
    if (pool <= 0) break;
    const take = Math.min(pool, c.amountMinor - c.paidMinor);
    pool -= take;
    const paidMinor = c.paidMinor + take;
    await tx.commission.update({ where: { id: c.id }, data: { paidMinor, status: paidMinor >= c.amountMinor ? "PAID" : "APPROVED" } });
  }
}

export async function processPayout(id: string, action: "APPROVE" | "PAY" | "REJECT", actorId: string, reference?: string, note?: string) {
  if (action === "PAY" && (await getOps()).payoutsPaused) throw new AppError("Payouts are paused.");
  return prisma.$transaction(async (tx) => {
    const p = await tx.payout.findUniqueOrThrow({ where: { id } });
    const allowed = { APPROVE: ["REQUESTED"], PAY: ["APPROVED"], REJECT: ["REQUESTED", "APPROVED"] }[action];
    if (!allowed.includes(p.status)) throw new AppError(`Can't ${action.toLowerCase()} a ${p.status.toLowerCase()} payout.`);
    if (action === "PAY" && !reference) throw new AppError("Enter the transfer reference.");
    if (p.userId === actorId) throw new AppError("You can't process your own payout.");
    const status = action === "APPROVE" ? "APPROVED" : action === "PAY" ? "PAID" : "REJECTED";
    await tx.payout.update({ where: { id }, data: { status, reference: reference || p.reference, note: note || p.note, processedById: actorId, processedAt: new Date() } });
    if (status === "PAID") await allocatePayout(tx, p.userId, p.amountMinor);
    await notify(p.userId, `Payout ${status.toLowerCase()}`, status === "REJECTED" ? `Your payout request was rejected${note ? `: ${note}` : "."}` : `Your payout request is ${status.toLowerCase()}.`, "/dashboard/payouts", tx);
    await audit(`payout.${status.toLowerCase()}`, "Payout", id, actorId, { reference, note }, tx);
  });
}
