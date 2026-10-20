import type { AffiliateNode, Leg, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";

/*
 * Volume definitions shown to members and admins
 *   credited    PV from matured orders (paid and past the refund window)
 *   reversed    PV taken back because a matured order was later refunded or charged back
 *   net         credited minus reversed: the lifetime figure
 *   period      net PV credited since the last binary run (the current pay period)
 *   qualifying  unpaired carry that the next binary run can pair, if the member qualifies
 *   pending     PV on paid orders still inside the refund window; it isn't in any total yet
 * Every figure comes from the VolumeEntry ledger, which is written only when an order matures or is reversed.
 */

const PAID = ["PAID", "SHIPPED", "DELIVERED"];

export interface LegVolume {
  creditedPv: number;
  reversedPv: number;
  netPv: number;
  periodPv: number;
  qualifyingPv: number;
  pendingPv: number;
}

export interface VolumeSummary {
  periodStart: Date | null;
  personal: Omit<LegVolume, "qualifyingPv">;
  left: LegVolume;
  right: LegVolume;
}

async function pendingPvUnder(nodeId: string | null, includeSelf: boolean, selfId: string) {
  if (!nodeId && !includeSelf) return 0;
  const rows = includeSelf
    ? await prisma.$queryRaw<{ pv: number }[]>`
        SELECT COALESCE(SUM(o."totalPv"), 0)::int AS pv FROM "Order" o
        WHERE o."volumeNodeId" = ${selfId} AND o.status::text = ANY(${PAID}) AND o."commissionedAt" IS NULL`
    : await prisma.$queryRaw<{ pv: number }[]>`
        SELECT COALESCE(SUM(o."totalPv"), 0)::int AS pv FROM "Order" o
        JOIN "AffiliateNode" n ON n.id = o."volumeNodeId"
        WHERE o.status::text = ANY(${PAID}) AND o."commissionedAt" IS NULL
          AND (n.id = ${nodeId} OR ${nodeId} = ANY(n."ancestorIds"))`;
  return rows[0]?.pv ?? 0;
}

export async function volumeSummary(node: AffiliateNode): Promise<VolumeSummary> {
  const lastRun = await prisma.binaryRun.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const since = lastRun?.createdAt ?? null;
  const [credited, reversed, period, children] = await Promise.all([
    prisma.volumeEntry.groupBy({ by: ["leg"], where: { nodeId: node.id, pv: { gt: 0 } }, _sum: { pv: true } }),
    prisma.volumeEntry.groupBy({ by: ["leg"], where: { nodeId: node.id, pv: { lt: 0 } }, _sum: { pv: true } }),
    prisma.volumeEntry.groupBy({ by: ["leg"], where: { nodeId: node.id, ...(since ? { createdAt: { gt: since } } : {}) }, _sum: { pv: true } }),
    prisma.affiliateNode.findMany({ where: { parentId: node.id }, select: { id: true, position: true } }),
  ]);
  const pick = (rows: typeof credited, leg: Leg | null) => rows.find((r) => r.leg === leg)?._sum.pv ?? 0;
  const child = (leg: Leg) => children.find((c) => c.position === leg)?.id ?? null;
  const [pendingSelf, pendingLeft, pendingRight] = await Promise.all([
    pendingPvUnder(null, true, node.id),
    pendingPvUnder(child("LEFT"), false, node.id),
    pendingPvUnder(child("RIGHT"), false, node.id),
  ]);
  const leg = (l: Leg, carry: number, pending: number): LegVolume => {
    const c = pick(credited, l);
    const r = Math.abs(pick(reversed, l));
    return { creditedPv: c, reversedPv: r, netPv: c - r, periodPv: pick(period, l), qualifyingPv: carry, pendingPv: pending };
  };
  const pc = pick(credited, null);
  const pr = Math.abs(pick(reversed, null));
  return {
    periodStart: since,
    personal: { creditedPv: pc, reversedPv: pr, netPv: pc - pr, periodPv: pick(period, null), pendingPv: pendingSelf },
    left: leg("LEFT", node.leftCarryPv, pendingLeft),
    right: leg("RIGHT", node.rightCarryPv, pendingRight),
  };
}

export interface ReconcileIssue {
  kind: string;
  ref: string;
  detail: string;
}

/**
 * Checks every derived network figure against its source:
 *   - node personal/leg totals and carry against the VolumeEntry and CarryMovement ledgers
 *   - node left/right member counts against the actual tree
 *   - each order's ledger entries against the order itself (matured orders credit totalPv up the
 *     correct leg of every ancestor; unmatured, refunded or cancelled orders net to zero)
 *   - direct commissions on refunded or cancelled orders must be reversed or clawed back
 * Read-only: it reports problems, it never edits balances.
 */
export async function reconcileVolume(actorId: string | null = null) {
  const issues: ReconcileIssue[] = [];

  const nodes = await prisma.$queryRaw<
    { id: string; code: string; personalPv: number; leftTotalPv: number; rightTotalPv: number; leftCarryPv: number; rightCarryPv: number; leftCount: number; rightCount: number; p: number; l: number; r: number; ml: number; mr: number; cl: number; cr: number }[]
  >`
    WITH e AS (
      SELECT "nodeId",
        SUM(CASE WHEN leg IS NULL THEN pv ELSE 0 END)::int AS p,
        SUM(CASE WHEN leg = 'LEFT' THEN pv ELSE 0 END)::int AS l,
        SUM(CASE WHEN leg = 'RIGHT' THEN pv ELSE 0 END)::int AS r
      FROM "VolumeEntry" GROUP BY "nodeId"),
    m AS (
      SELECT "nodeId",
        SUM(CASE WHEN leg = 'LEFT' THEN pv ELSE 0 END)::int AS ml,
        SUM(CASE WHEN leg = 'RIGHT' THEN pv ELSE 0 END)::int AS mr
      FROM "CarryMovement" GROUP BY "nodeId"),
    paths AS (
      SELECT a.anc, COALESCE(d."ancestorIds"[a.i + 1], d.id) AS nxt
      FROM "AffiliateNode" d, unnest(d."ancestorIds") WITH ORDINALITY AS a(anc, i)),
    c AS (
      SELECT paths.anc AS "nodeId",
        COUNT(*) FILTER (WHERE p.position = 'LEFT')::int AS cl,
        COUNT(*) FILTER (WHERE p.position = 'RIGHT')::int AS cr
      FROM paths JOIN "AffiliateNode" p ON p.id = paths.nxt GROUP BY paths.anc)
    SELECT n.id, u."referralCode" AS code, n."personalPv", n."leftTotalPv", n."rightTotalPv", n."leftCarryPv", n."rightCarryPv", n."leftCount", n."rightCount",
      COALESCE(e.p, 0) AS p, COALESCE(e.l, 0) AS l, COALESCE(e.r, 0) AS r,
      COALESCE(m.ml, 0) AS ml, COALESCE(m.mr, 0) AS mr, COALESCE(c.cl, 0) AS cl, COALESCE(c.cr, 0) AS cr
    FROM "AffiliateNode" n JOIN "User" u ON u.id = n."userId"
    LEFT JOIN e ON e."nodeId" = n.id LEFT JOIN m ON m."nodeId" = n.id LEFT JOIN c ON c."nodeId" = n.id`;

  for (const n of nodes) {
    const check = (what: string, stored: number, expected: number) => {
      if (stored !== expected) issues.push({ kind: "node", ref: n.code, detail: `${what}: stored ${stored}, ledger says ${expected}` });
    };
    check("personal PV", n.personalPv, n.p);
    check("left total PV", n.leftTotalPv, n.l);
    check("right total PV", n.rightTotalPv, n.r);
    check("left carry PV", n.leftCarryPv, n.l + n.ml);
    check("right carry PV", n.rightCarryPv, n.r + n.mr);
    check("left member count", n.leftCount, n.cl);
    check("right member count", n.rightCount, n.cr);
  }

  const orders = await prisma.$queryRaw<{ number: string; expected: number; actual: number }[]>`
    SELECT o.number,
      CASE WHEN o.status::text = ANY(${PAID}) AND o."commissionedAt" IS NOT NULL AND o."volumeNodeId" IS NOT NULL THEN o."totalPv" ELSE 0 END AS expected,
      COALESCE((SELECT SUM(v.pv) FROM "VolumeEntry" v WHERE v."orderId" = o.id AND v.leg IS NULL AND v."nodeId" = o."volumeNodeId"), 0)::int AS actual
    FROM "Order" o
    WHERE o."commissionedAt" IS NOT NULL OR EXISTS (SELECT 1 FROM "VolumeEntry" v WHERE v."orderId" = o.id)`;
  for (const o of orders) {
    if (o.expected !== o.actual) issues.push({ kind: "order", ref: o.number, detail: `personal PV credited ${o.actual}, order says ${o.expected}` });
  }

  // Leg entries per (order, ancestor): must equal the personal credit, on the correct leg, for every ancestor and nobody else.
  const legRows = await prisma.$queryRaw<{ number: string; nodeId: string; leg: string | null; expected: number; actual: number }[]>`
    WITH personal AS (
      SELECT v."orderId", v."nodeId" AS src, SUM(v.pv)::int AS pv FROM "VolumeEntry" v WHERE v.leg IS NULL GROUP BY 1, 2),
    expected AS (
      SELECT p."orderId", a.anc AS "nodeId", nx.position::text AS leg, p.pv
      FROM personal p JOIN "AffiliateNode" s ON s.id = p.src
        CROSS JOIN LATERAL unnest(s."ancestorIds") WITH ORDINALITY AS a(anc, i)
        JOIN "AffiliateNode" nx ON nx.id = COALESCE(s."ancestorIds"[a.i + 1], s.id)),
    actual AS (
      SELECT v."orderId", v."nodeId", v.leg::text AS leg, SUM(v.pv)::int AS pv FROM "VolumeEntry" v WHERE v.leg IS NOT NULL GROUP BY 1, 2, 3)
    SELECT o.number, COALESCE(x."nodeId", y."nodeId") AS "nodeId", COALESCE(x.leg, y.leg) AS leg,
      COALESCE(x.pv, 0) AS expected, COALESCE(y.pv, 0) AS actual
    FROM expected x FULL OUTER JOIN actual y ON x."orderId" = y."orderId" AND x."nodeId" = y."nodeId" AND x.leg = y.leg
    JOIN "Order" o ON o.id = COALESCE(x."orderId", y."orderId")
    WHERE COALESCE(x.pv, 0) <> COALESCE(y.pv, 0)
    LIMIT 200`;
  for (const r of legRows) {
    issues.push({ kind: "order", ref: r.number, detail: `${r.leg?.toLowerCase()} leg PV on node ${r.nodeId}: ${r.actual}, expected ${r.expected}` });
  }

  const commissions = await prisma.$queryRaw<{ number: string; id: string }[]>`
    SELECT o.number, c.id FROM "Commission" c JOIN "Order" o ON o.id = c."orderId"
    WHERE c.type = 'DIRECT' AND o.status IN ('REFUNDED', 'CANCELLED') AND c.status <> 'REVERSED'
      AND NOT EXISTS (SELECT 1 FROM "Commission" adj WHERE adj.type = 'ADJUSTMENT' AND adj.details->>'reverses' = c.id)`;
  for (const c of commissions) {
    issues.push({ kind: "commission", ref: c.number, detail: `direct commission ${c.id} is still live on a refunded or cancelled order` });
  }

  const result = { checkedAt: new Date().toISOString(), nodes: nodes.length, orders: orders.length, issueCount: issues.length, issues: issues.slice(0, 100) };
  await audit("volume.reconcile", "Network", "all", actorId, result as unknown as Prisma.InputJsonObject);
  return result;
}
