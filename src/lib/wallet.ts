import { z } from "zod";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { getShopSettings } from "./settings";
import { audit } from "./audit";

export async function walletBalance(userId: string, tx: Tx = prisma) {
  const [earned, paidOut] = await Promise.all([
    tx.commission.aggregate({ where: { userId, status: "AVAILABLE" }, _sum: { amountMinor: true } }),
    tx.payout.aggregate({ where: { userId, status: { not: "REJECTED" } }, _sum: { amountMinor: true } }),
  ]);
  const e = earned._sum.amountMinor ?? 0;
  const p = paidOut._sum.amountMinor ?? 0;
  return { earnedMinor: e, withdrawnMinor: p, availableMinor: e - p };
}

export const payoutSchema = z.object({
  amountMinor: z.number().int().positive(),
  method: z.enum(["BANK_TRANSFER", "MOBILE_MONEY"]),
  destination: z.string().trim().min(4).max(200),
});

export async function requestPayout(userId: string, raw: z.input<typeof payoutSchema>) {
  const input = payoutSchema.parse(raw);
  const shop = await getShopSettings();
  if (input.amountMinor < shop.minPayoutMinor) throw new AppError("Amount is below the minimum payout.");
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

export async function processPayout(id: string, action: "APPROVE" | "PAY" | "REJECT", actorId: string, reference?: string, note?: string) {
  return prisma.$transaction(async (tx) => {
    const p = await tx.payout.findUniqueOrThrow({ where: { id } });
    const allowed = { APPROVE: ["REQUESTED"], PAY: ["APPROVED"], REJECT: ["REQUESTED", "APPROVED"] }[action];
    if (!allowed.includes(p.status)) throw new AppError(`Can't ${action.toLowerCase()} a ${p.status.toLowerCase()} payout.`);
    if (action === "PAY" && !reference) throw new AppError("Enter the transfer reference.");
    const status = action === "APPROVE" ? "APPROVED" : action === "PAY" ? "PAID" : "REJECTED";
    await tx.payout.update({ where: { id }, data: { status, reference: reference || p.reference, note: note || p.note, processedById: actorId, processedAt: new Date() } });
    await audit(`payout.${status.toLowerCase()}`, "Payout", id, actorId, { reference, note }, tx);
  });
}
