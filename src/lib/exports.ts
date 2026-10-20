import type { AdminPermission, LedgerBucket, LedgerType, OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { nairaCell, toCsv } from "./csv";
import { dateWhere, lagosDay, parseRange, searchText, type DateRange } from "./admin-filters";
import { attributionReport, payoutReconciliation, revenueReport } from "./reports";

/*
 * Admin CSV exports. Each report names the permission it needs; the route checks it and a fresh
 * authenticator code. Every download is written to the audit log. Exports never include bank account
 * numbers, password data or session details. Cells are protected against spreadsheet formulas (see csv.ts).
 */

const MAX_ROWS = 50_000;

type Params = URLSearchParams;
type Report = { perm: AdminPermission; build: (p: Params, r: DateRange) => Promise<{ headers: string[]; rows: unknown[][] }> };

const ORDER_STATUSES: OrderStatus[] = ["PENDING_PAYMENT", "PAID", "PROCESSING", "SHIPPED", "DELIVERED", "PARTIALLY_REFUNDED", "CANCELLED", "REFUNDED"];

export const REPORTS: Record<string, Report> = {
  orders: {
    perm: "ORDERS",
    async build(p, r) {
      const q = searchText(p.get("q") ?? undefined);
      const status = p.get("status") as OrderStatus;
      const where: Prisma.OrderWhereInput = {
        ...(ORDER_STATUSES.includes(status) ? { status } : {}),
        ...(dateWhere(r) ? { createdAt: dateWhere(r) } : {}),
        ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" } }, { user: { email: { contains: q, mode: "insensitive" } } }] } : {}),
      };
      const orders = await prisma.order.findMany({ where, include: { user: { select: { email: true } } }, orderBy: { createdAt: "desc" }, take: MAX_ROWS });
      const refIds = [...new Set(orders.map((o) => o.referrerId).filter((x): x is string => !!x))];
      const codes = new Map((await prisma.user.findMany({ where: { id: { in: refIds } }, select: { id: true, referralCode: true } })).map((u) => [u.id, u.referralCode]));
      return {
        headers: ["order", "created", "paid", "status", "customer_email", "referrer_code", "goods_ngn", "discount_ngn", "delivery_ngn", "vat_ngn", "total_ngn", "refunded_ngn", "pv", "plan_version"],
        rows: orders.map((o) => [o.number, o.createdAt, o.paidAt, o.status, o.user.email, o.referrerId ? codes.get(o.referrerId) : "", nairaCell(o.subtotalMinor), nairaCell(o.discountMinor), nairaCell(o.shippingMinor), nairaCell(o.taxMinor), nairaCell(o.totalMinor), nairaCell(o.refundedMinor), o.totalPv, o.planVersionId]),
      };
    },
  },
  members: {
    perm: "MEMBERS",
    async build(p, r) {
      const q = searchText(p.get("q") ?? undefined);
      const users = await prisma.user.findMany({
        where: { ...(dateWhere(r) ? { createdAt: dateWhere(r) } : {}), ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { referralCode: { contains: q, mode: "insensitive" } }] } : {}) },
        select: { name: true, email: true, role: true, status: true, referralCode: true, createdAt: true, sponsor: { select: { referralCode: true } }, node: { select: { position: true, depth: true } } },
        orderBy: { createdAt: "desc" },
        take: MAX_ROWS,
      });
      return {
        headers: ["name", "email", "role", "status", "referral_code", "sponsor_code", "side", "level", "joined"],
        rows: users.map((u) => [u.name, u.email, u.role, u.status, u.referralCode, u.sponsor?.referralCode, u.node?.position, u.node?.depth, u.createdAt]),
      };
    },
  },
  commissions: {
    perm: "COMMISSIONS",
    async build(_p, r) {
      const list = await prisma.commission.findMany({ where: dateWhere(r) ? { createdAt: dateWhere(r) } : {}, include: { user: { select: { email: true } }, order: { select: { number: true } } }, orderBy: { createdAt: "desc" }, take: MAX_ROWS });
      return {
        headers: ["id", "created", "member_email", "type", "status", "order", "base_ngn", "rate_bps", "amount_ngn", "reversed_ngn", "plan_version"],
        rows: list.map((c) => [c.id, c.createdAt, c.user.email, c.type, c.status, c.order?.number, c.baseMinor === null ? "" : nairaCell(c.baseMinor), c.rateBps, nairaCell(c.amountMinor), nairaCell(c.reversedMinor), c.planVersionId]),
      };
    },
  },
  ledger: {
    perm: "COMMISSIONS",
    async build(p, r) {
      const rows = await prisma.ledgerEntry.findMany({ where: await ledgerWhere(p, r), include: { user: { select: { email: true } } }, orderBy: { createdAt: "desc" }, take: MAX_ROWS });
      return {
        headers: ["id", "created", "member_email", "type", "amount_ngn", "from", "to", "source", "source_id", "idempotency_key", "memo"],
        rows: rows.map((e) => [e.id, e.createdAt, e.user.email, e.type, nairaCell(e.amountMinor), e.fromBucket ?? "outside", e.toBucket ?? "outside", e.sourceType, e.sourceId, e.idempotencyKey, e.memo]),
      };
    },
  },
  payouts: {
    perm: "PAYOUTS",
    async build(_p, r) {
      const list = await prisma.payout.findMany({ where: dateWhere(r) ? { createdAt: dateWhere(r) } : {}, include: { user: { select: { email: true } }, batch: { select: { number: true } } }, orderBy: { createdAt: "desc" }, take: MAX_ROWS });
      return {
        // `destination` is the masked label (bank •••• last 4); full numbers are only in the batch transfer file.
        headers: ["id", "requested", "member_email", "amount_ngn", "status", "destination", "batch", "attempt", "reference", "settled", "settlement_source", "failure_reason"],
        rows: list.map((x) => [x.id, x.createdAt, x.user.email, nairaCell(x.amountMinor), x.status, x.destination, x.batch?.number, x.attempt, x.reference, x.settledAt, x.settlementSource, x.failureReason]),
      };
    },
  },
  audit: {
    perm: "AUDIT",
    async build(p, r) {
      const q = searchText(p.get("q") ?? undefined);
      const logs = await prisma.auditLog.findMany({
        where: { ...(dateWhere(r) ? { createdAt: dateWhere(r) } : {}), ...(q ? { OR: [{ action: { contains: q } }, { entityId: q }, { actorId: q }] } : {}) },
        orderBy: { seq: "desc" },
        take: MAX_ROWS,
      });
      return {
        headers: ["seq", "chain_pos", "created", "actor_id", "action", "entity", "entity_id", "data", "hash"],
        rows: logs.map((l) => [Number(l.seq), l.chainPos, l.createdAt, l.actorId ?? "system", l.action, l.entity, l.entityId, l.data, l.hash]),
      };
    },
  },
  revenue: {
    perm: "ORDERS",
    async build(p, r) {
      const { rows } = await revenueReport(r, p.get("group") === "month" ? "month" : "day");
      return {
        headers: ["period", "paid_orders", "goods_ngn", "discount_ngn", "delivery_ngn", "vat_ngn", "total_ngn", "refunded_ngn", "net_ngn"],
        rows: rows.map((x) => [x.period, x.orders, nairaCell(x.goodsMinor), nairaCell(x.discountMinor), nairaCell(x.shippingMinor), nairaCell(x.taxMinor), nairaCell(x.totalMinor), nairaCell(x.refundedMinor), nairaCell(x.netMinor)]),
      };
    },
  },
  attribution: {
    perm: "COMMISSIONS",
    async build(p, r) {
      const { rows } = await attributionReport(r, searchText(p.get("q") ?? undefined), MAX_ROWS);
      return {
        headers: ["referral_code", "name", "email", "retail_orders", "retail_sales_ngn", "refunded_ngn", "direct_commission_ngn", "purchases_by_sponsored_affiliates"],
        rows: rows.map((x) => [x.referralCode, x.name, x.email, x.orders, nairaCell(x.goodsMinor), nairaCell(x.refundedMinor), nairaCell(x.commissionMinor), x.memberPurchases]),
      };
    },
  },
  "payout-reconciliation": {
    perm: "PAYOUTS",
    async build(_p, r) {
      const rec = await payoutReconciliation(r);
      return { headers: ["payout_id", "issue"], rows: rec.problems.map((x) => [x.payoutId, x.issue]) };
    },
  },
};

const LEDGER_TYPES: LedgerType[] = ["COMMISSION_EARNED", "COMMISSION_APPROVED", "COMMISSION_HELD", "COMMISSION_RELEASED", "COMMISSION_REVERSED", "WITHDRAWAL_RESERVED", "WITHDRAWAL_PAID", "WITHDRAWAL_RELEASED", "ADMIN_CORRECTION"];
const BUCKETS: LedgerBucket[] = ["PENDING", "HELD", "AVAILABLE", "RESERVED", "PAID_OUT", "REVERSED"];

/** Filters for the ledger search page and its export: member, entry type, bucket, source or key, dates. */
export async function ledgerWhere(p: Params, r: DateRange): Promise<Prisma.LedgerEntryWhereInput> {
  const member = searchText(p.get("member") ?? undefined);
  const type = p.get("type") as LedgerType;
  const bucket = p.get("bucket") as LedgerBucket;
  const ref = searchText(p.get("ref") ?? undefined);
  let userIds: string[] | undefined;
  if (member) {
    userIds = (await prisma.user.findMany({ where: { OR: [{ email: { contains: member, mode: "insensitive" } }, { referralCode: { equals: member, mode: "insensitive" } }, { id: member }] }, select: { id: true }, take: 50 })).map((u) => u.id);
  }
  return {
    ...(userIds ? { userId: { in: userIds } } : {}),
    ...(LEDGER_TYPES.includes(type) ? { type } : {}),
    ...(BUCKETS.includes(bucket) ? { OR: [{ fromBucket: bucket }, { toBucket: bucket }] } : {}),
    ...(ref ? { AND: [{ OR: [{ sourceId: ref }, { idempotencyKey: { contains: ref } }, { commissionId: ref }, { payoutId: ref }] }] } : {}),
    ...(dateWhere(r) ? { createdAt: dateWhere(r) } : {}),
  };
}
export { LEDGER_TYPES, BUCKETS };

export async function buildExport(report: string, params: Params, actorId: string) {
  const def = REPORTS[report];
  if (!def) return null;
  const r = parseRange(params.get("from"), params.get("to"));
  const { headers, rows } = await def.build(params, r);
  await audit("export.csv", "Report", report, actorId, { report, from: r.from ?? null, to: r.to ?? null, rows: rows.length, filters: Object.fromEntries([...params.entries()].filter(([k]) => k !== "page")), privileged: true });
  const stamp = lagosDay(new Date());
  return { filename: `${report}-${r.from ?? "all"}-${r.to ?? stamp}.csv`, csv: toCsv(headers, rows), truncated: rows.length >= MAX_ROWS };
}
