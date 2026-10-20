import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { EVER_PAID } from "./order-state";
import type { DateRange } from "./admin-filters";

/*
 * Read-only admin reports. All money is integer kobo. Dates are grouped in Lagos time.
 * Callers check permissions; nothing here changes data.
 */

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
const paidStatuses = Prisma.join(EVER_PAID.map((s) => Prisma.sql`${s}::"OrderStatus"`));

function rangeSql(column: Prisma.Sql, r: DateRange) {
  return Prisma.sql`${r.gte ? Prisma.sql`AND ${column} >= ${r.gte}` : Prisma.empty} ${r.lt ? Prisma.sql`AND ${column} < ${r.lt}` : Prisma.empty}`;
}

export type RevenueRow = { period: string; orders: number; goodsMinor: number; discountMinor: number; shippingMinor: number; taxMinor: number; totalMinor: number; refundedMinor: number; netMinor: number };

/**
 * Paid orders grouped by the day or month they were paid. "Refunded" is what has been refunded on those
 * orders so far (whenever the refund happened), so net = total − refunded is what the shop kept from them.
 */
export async function revenueReport(r: DateRange, group: "day" | "month" = "day"): Promise<{ rows: RevenueRow[]; totals: Omit<RevenueRow, "period"> }> {
  const unit = group === "month" ? Prisma.sql`'month'` : Prisma.sql`'day'`;
  const raw = await prisma.$queryRaw<{ period: Date; orders: bigint; goods: bigint; discount: bigint; shipping: bigint; tax: bigint; total: bigint; refunded: bigint }[]>`
    SELECT date_trunc(${unit}, o."paidAt" AT TIME ZONE 'Africa/Lagos') AS period,
      COUNT(*) AS orders, SUM(o."subtotalMinor") AS goods, SUM(o."discountMinor") AS discount, SUM(o."shippingMinor") AS shipping,
      SUM(o."taxMinor") AS tax, SUM(o."totalMinor") AS total, SUM(o."refundedMinor") AS refunded
    FROM "Order" o
    WHERE o.status IN (${paidStatuses}) AND o."paidAt" IS NOT NULL ${rangeSql(Prisma.sql`o."paidAt"`, r)}
    GROUP BY 1 ORDER BY 1 DESC`;
  const rows = raw.map((x) => {
    const total = n(x.total);
    const refunded = n(x.refunded);
    return {
      period: x.period.toISOString().slice(0, group === "month" ? 7 : 10),
      orders: n(x.orders), goodsMinor: n(x.goods), discountMinor: n(x.discount), shippingMinor: n(x.shipping), taxMinor: n(x.tax),
      totalMinor: total, refundedMinor: refunded, netMinor: total - refunded,
    };
  });
  const totals = rows.reduce(
    (a, x) => ({
      orders: a.orders + x.orders, goodsMinor: a.goodsMinor + x.goodsMinor, discountMinor: a.discountMinor + x.discountMinor, shippingMinor: a.shippingMinor + x.shippingMinor,
      taxMinor: a.taxMinor + x.taxMinor, totalMinor: a.totalMinor + x.totalMinor, refundedMinor: a.refundedMinor + x.refundedMinor, netMinor: a.netMinor + x.netMinor,
    }),
    { orders: 0, goodsMinor: 0, discountMinor: 0, shippingMinor: 0, taxMinor: 0, totalMinor: 0, refundedMinor: 0, netMinor: 0 },
  );
  return { rows, totals };
}

/** Refunds by the date they were confirmed, for cash-basis reporting. */
export async function refundsInRange(r: DateRange) {
  const a = await prisma.refund.aggregate({ where: { status: "PROCESSED", processedAt: { ...(r.gte ? { gte: r.gte } : {}), ...(r.lt ? { lt: r.lt } : {}) } }, _sum: { amountMinor: true }, _count: true });
  return { count: a._count, amountMinor: a._sum.amountMinor ?? 0 };
}

export type AttributionRow = { referrerId: string | null; name: string | null; email: string | null; referralCode: string | null; orders: number; goodsMinor: number; refundedMinor: number; commissionMinor: number; memberPurchases: number };

/**
 * Paid orders grouped by the affiliate they were attributed to. Orders are attributed to the buyer's sponsor.
 * Retail orders (buyer is a customer) are counted separately from purchases by affiliates the referrer
 * sponsored ("memberPurchases"), which earn no direct commission unless the plan allows it.
 */
export async function attributionReport(r: DateRange, q?: string, limit = 200): Promise<{ rows: AttributionRow[]; unattributed: { orders: number; goodsMinor: number } }> {
  const search = q ? Prisma.sql`AND (u.email ILIKE ${`%${q}%`} OR u.name ILIKE ${`%${q}%`} OR u."referralCode" ILIKE ${`%${q}%`})` : Prisma.empty;
  const retail = Prisma.sql`b.role = 'CUSTOMER'`;
  const rows = await prisma.$queryRaw<{ referrerId: string; name: string; email: string; referralCode: string; orders: bigint; goods: bigint; refunded: bigint; commission: bigint; members: bigint }[]>`
    SELECT o."referrerId", u.name, u.email, u."referralCode",
      COUNT(*) FILTER (WHERE ${retail}) AS orders,
      COALESCE(SUM(o."subtotalMinor" - o."discountMinor") FILTER (WHERE ${retail}), 0) AS goods,
      COALESCE(SUM(LEAST(o."refundedMinor", o."subtotalMinor" - o."discountMinor")) FILTER (WHERE ${retail}), 0) AS refunded,
      COALESCE((SELECT SUM(c."amountMinor" - c."reversedMinor") FROM "Commission" c JOIN "Order" o2 ON o2.id = c."orderId"
        WHERE c."userId" = o."referrerId" AND c.type = 'DIRECT' AND o2.status IN (${paidStatuses}) AND o2."paidAt" IS NOT NULL ${rangeSql(Prisma.sql`o2."paidAt"`, r)}), 0) AS commission,
      COUNT(*) FILTER (WHERE NOT ${retail}) AS members
    FROM "Order" o JOIN "User" u ON u.id = o."referrerId" JOIN "User" b ON b.id = o."userId"
    WHERE o.status IN (${paidStatuses}) AND o."paidAt" IS NOT NULL AND o."userId" <> o."referrerId" ${rangeSql(Prisma.sql`o."paidAt"`, r)} ${search}
    GROUP BY o."referrerId", u.name, u.email, u."referralCode"
    ORDER BY goods DESC LIMIT ${limit}`;
  const un = await prisma.$queryRaw<{ orders: bigint; goods: bigint }[]>`
    SELECT COUNT(*) AS orders, COALESCE(SUM(o."subtotalMinor" - o."discountMinor"), 0) AS goods FROM "Order" o
    WHERE o."referrerId" IS NULL AND o.status IN (${paidStatuses}) AND o."paidAt" IS NOT NULL ${rangeSql(Prisma.sql`o."paidAt"`, r)}`;
  return {
    rows: rows.map((x) => ({ referrerId: x.referrerId, name: x.name, email: x.email, referralCode: x.referralCode, orders: n(x.orders), goodsMinor: n(x.goods), refundedMinor: n(x.refunded), commissionMinor: n(x.commission), memberPurchases: n(x.members) })),
    unattributed: { orders: n(un[0]?.orders), goodsMinor: n(un[0]?.goods) },
  };
}

export type PayoutProblem = { payoutId: string; issue: string };

/**
 * Withdrawals against the wallet ledger for a period: totals by status, batches, and any payout whose
 * ledger entries don't match its status (e.g. marked paid without a "paid" entry, or reserved twice).
 */
export async function payoutReconciliation(r: DateRange) {
  const created = { createdAt: { ...(r.gte ? { gte: r.gte } : {}), ...(r.lt ? { lt: r.lt } : {}) } };
  const [byStatus, settled, ledgerPaid, batches, perPayout] = await Promise.all([
    prisma.payout.groupBy({ by: ["status"], where: created, _sum: { amountMinor: true }, _count: true }),
    prisma.payout.aggregate({ where: { status: "PAID", settledAt: { ...(r.gte ? { gte: r.gte } : {}), ...(r.lt ? { lt: r.lt } : {}) } }, _sum: { amountMinor: true }, _count: true }),
    prisma.ledgerEntry.aggregate({ where: { type: "WITHDRAWAL_PAID", ...created }, _sum: { amountMinor: true }, _count: true }),
    prisma.payoutBatch.findMany({ where: created, orderBy: { createdAt: "desc" }, take: 50, include: { payouts: { select: { status: true, amountMinor: true } } } }),
    prisma.$queryRaw<{ id: string; status: string; amountMinor: number; reserved: bigint; released: bigint; paid: bigint }[]>`
      SELECT p.id, p.status::text AS status, p."amountMinor",
        COALESCE(SUM(e."amountMinor") FILTER (WHERE e.type = 'WITHDRAWAL_RESERVED'), 0) AS reserved,
        COALESCE(SUM(e."amountMinor") FILTER (WHERE e.type = 'WITHDRAWAL_RELEASED'), 0) AS released,
        COALESCE(SUM(e."amountMinor") FILTER (WHERE e.type = 'WITHDRAWAL_PAID'), 0) AS paid
      FROM "Payout" p LEFT JOIN "LedgerEntry" e ON e."payoutId" = p.id
      WHERE TRUE ${rangeSql(Prisma.sql`p."createdAt"`, r)}
      GROUP BY p.id`,
  ]);
  const problems: PayoutProblem[] = [];
  for (const p of perPayout) {
    const held = n(p.reserved) - n(p.released) - n(p.paid);
    const open = ["REQUESTED", "APPROVED", "PROCESSING"].includes(p.status);
    if (p.status === "PAID" && n(p.paid) !== p.amountMinor) problems.push({ payoutId: p.id, issue: `Marked paid but the ledger shows ${n(p.paid)} paid out` });
    if (p.status !== "PAID" && n(p.paid) > 0) problems.push({ payoutId: p.id, issue: `Ledger shows a payment but the withdrawal is ${p.status.toLowerCase()}` });
    if (open && held !== p.amountMinor) problems.push({ payoutId: p.id, issue: `Open withdrawal should hold ${p.amountMinor} but holds ${held}` });
    if (!open && held !== 0) problems.push({ payoutId: p.id, issue: `Closed withdrawal still holds ${held}` });
  }
  return {
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count, amountMinor: s._sum.amountMinor ?? 0 })),
    settled: { count: settled._count, amountMinor: settled._sum.amountMinor ?? 0 },
    ledgerPaid: { count: ledgerPaid._count, amountMinor: ledgerPaid._sum.amountMinor ?? 0 },
    batches: batches.map((b) => ({
      id: b.id, number: b.number, status: b.status, createdAt: b.createdAt, exportedAt: b.exportedAt, count: b.count, totalMinor: b.totalMinor,
      paid: b.payouts.filter((p) => p.status === "PAID").length, failed: b.payouts.filter((p) => p.status === "FAILED").length,
      open: b.payouts.filter((p) => p.status === "PROCESSING").length,
    })),
    problems,
  };
}

/** Sales and order totals for the overview cards. */
export async function salesOverview(r: DateRange) {
  const where = { status: { in: EVER_PAID }, paidAt: { ...(r.gte ? { gte: r.gte } : {}), ...(r.lt ? { lt: r.lt } : {}) } };
  const [paid, pending, byStatus] = await Promise.all([
    prisma.order.aggregate({ where, _sum: { totalMinor: true, refundedMinor: true }, _count: true }),
    prisma.order.count({ where: { status: "PENDING_PAYMENT", createdAt: where.paidAt } }),
    prisma.order.groupBy({ by: ["status"], where: { createdAt: where.paidAt }, _count: true }),
  ]);
  const total = paid._sum.totalMinor ?? 0;
  const refunded = paid._sum.refundedMinor ?? 0;
  return {
    paidOrders: paid._count, totalMinor: total, refundedMinor: refunded, netMinor: total - refunded,
    averageMinor: paid._count ? Math.round(total / paid._count) : 0, pendingOrders: pending,
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])) as Record<string, number>,
  };
}
