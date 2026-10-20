import { prisma } from "./db";
import { EVER_PAID } from "./order-state";
import { walletBalance } from "./wallet";

/*
 * Everything the member dashboard shows, read on the server for the signed-in member only.
 * Every query is filtered by the member's own id. Buyer details are reduced to a first name and initial.
 */

/** Sales by customers this member referred, counting only orders whose payment was verified with the gateway. */
export async function verifiedSales(userId: string) {
  const where = { referrerId: userId, userId: { not: userId }, paidPaymentId: { not: null }, status: { in: EVER_PAID } };
  const agg = await prisma.order.aggregate({ where, _sum: { subtotalMinor: true, discountMinor: true, refundedMinor: true }, _count: true });
  const goodsMinor = (agg._sum.subtotalMinor ?? 0) - (agg._sum.discountMinor ?? 0);
  // Refunds can include delivery, so never show a negative net.
  const refundedMinor = Math.min(agg._sum.refundedMinor ?? 0, goodsMinor);
  return { orders: agg._count, goodsMinor, refundedMinor, netMinor: goodsMinor - refundedMinor };
}

export function shortName(name: string) {
  const [first, second] = name.trim().split(/\s+/);
  return second ? `${first} ${second[0]}.` : first;
}

export async function memberOverview(userId: string) {
  const [wallet, sales, referrals, activeReferrals, recentSales, notifications, unread, payouts] = await Promise.all([
    walletBalance(userId),
    verifiedSales(userId),
    prisma.user.count({ where: { sponsorId: userId } }),
    prisma.user.count({ where: { sponsorId: userId, role: "AFFILIATE", status: "ACTIVE" } }),
    prisma.order.findMany({
      where: { referrerId: userId, userId: { not: userId }, status: { in: EVER_PAID } },
      select: { id: true, number: true, status: true, paidAt: true, subtotalMinor: true, discountMinor: true, user: { select: { name: true } }, commissions: { where: { userId, type: "DIRECT" }, select: { amountMinor: true, reversedMinor: true, status: true } } },
      orderBy: { paidAt: "desc" },
      take: 5,
    }),
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.payout.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 3, select: { id: true, amountMinor: true, status: true, createdAt: true, settledAt: true } }),
  ]);
  return {
    wallet,
    sales,
    referrals,
    activeReferrals,
    recentSales: recentSales.map((o) => ({ ...o, buyer: shortName(o.user.name), user: undefined })),
    notifications,
    unread,
    payouts,
  };
}
