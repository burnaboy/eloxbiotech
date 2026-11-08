import { randomUUID } from "node:crypto";
import type { AffiliateNode, Order, User } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { getOps, type CompPlan } from "./settings";
import { applyVolume } from "./tree";
import { computePairing } from "./binary";
import { audit } from "./audit";
import { notify } from "./notify";
import { currentPlanVersion, planForOrder, rulesOf } from "./comp-plan";
import { LIVE_PAID } from "./order-state";
import { balances, commissionBucket, lockWallet, post } from "./ledger";

/*
 * Commission engine.
 *
 * DIRECT commission (the only payout enabled for the first release)
 *   commission_kobo = floor(eligible_net_sales_kobo × rate_basis_points / 10000)
 *   eligible net sales = Σ over commissionable lines of (line value after discount, excluding VAT),
 *                        minus anything refunded. Shipping and VAT are never commissionable.
 *   It goes to the buyer's sponsor, only if the sponsor is an active affiliate and the buyer is a customer
 *   (not the sponsor, and not another member buying for themselves, unless the plan explicitly allows it).
 *   Nothing is paid for signing up, recruiting, or empty positions: only paid product orders create commissions.
 *
 * Every commission stores the plan version, qualifying amount, rate and inputs, so it can be recomputed exactly.
 *
 * Lifecycle (each step also posts to the ledger, see ledger.ts)
 *   order paid           → PENDING           (null → PENDING)
 *   dispute opened       → HELD              (PENDING → HELD)
 *   refund window passes → APPROVED          (PENDING → AVAILABLE), and the order's volume enters the tree
 *   refund / chargeback  → recalculated on what is left; the difference is REVERSED (→ REVERSED)
 *
 * BINARY matching is calculated by runBinary only when the plan version has binaryEnabled = true.
 * It is off by default until its rules, caps and refund treatment are approved. Volume is tracked either way.
 */

export const DISPUTE_HOLD = "Payment dispute";

/** floor(base × bps / 10000) in exact integer arithmetic. */
export function commissionFor(baseMinor: number, rateBps: number) {
  if (!Number.isSafeInteger(baseMinor) || !Number.isSafeInteger(rateBps) || baseMinor < 0 || rateBps < 0) throw new Error("Invalid commission input");
  return Number((BigInt(baseMinor) * BigInt(rateBps)) / 10_000n);
}

type ItemLike = { commissionable: boolean; netMinor: number; refundedNetMinor: number };

/** Eligible net sales of an order: commissionable lines, after discount, excluding VAT and shipping, minus refunds. */
export function eligibleNet(items: ItemLike[]) {
  return items.filter((i) => i.commissionable).reduce((s, i) => s + i.netMinor - i.refundedNetMinor, 0);
}

/** Why an order doesn't earn a direct commission, or null if it does. */
export function directIneligibility(buyer: Pick<User, "id" | "role">, referrer: Pick<User, "id" | "role" | "status"> | null, plan: CompPlan) {
  if (!referrer) return "No sponsor";
  if (referrer.id === buyer.id) return "Own purchase";
  if (referrer.role !== "AFFILIATE") return "Sponsor is not an affiliate";
  if (referrer.status !== "ACTIVE") return "Sponsor account is not active";
  if (buyer.role !== "CUSTOMER" && !plan.directOnMemberPurchases) return "Buyer is a member, not a retail customer";
  if (plan.directRateBps <= 0) return "Direct commission rate is 0";
  return null;
}

/** Called in the same transaction that marks an order PAID (order.planVersionId must already be set). */
export async function onOrderPaid(tx: Tx, order: Pick<Order, "id" | "number" | "userId" | "referrerId" | "paidAt" | "planVersionId">) {
  const { version, rules } = await planForOrder(tx, order);
  const [buyer, referrer, items] = await Promise.all([
    tx.user.findUniqueOrThrow({ where: { id: order.userId }, select: { id: true, role: true } }),
    order.referrerId ? tx.user.findUnique({ where: { id: order.referrerId }, select: { id: true, role: true, status: true } }) : null,
    tx.orderItem.findMany({ where: { orderId: order.id }, select: { id: true, commissionable: true, netMinor: true, refundedNetMinor: true } }),
  ]);
  const why = directIneligibility(buyer, referrer, rules);
  const baseMinor = eligibleNet(items);
  const amountMinor = why ? 0 : commissionFor(baseMinor, rules.directRateBps);
  if (!referrer || why || amountMinor <= 0) {
    if (order.referrerId) await audit("commission.notEarned", "Order", order.id, null, { reason: why ?? "Nothing commissionable", baseMinor, planVersion: version.version }, tx);
    return null;
  }
  const paidAt = order.paidAt ?? new Date();
  const c = await tx.commission.create({
    data: {
      userId: referrer.id,
      type: "DIRECT",
      status: "PENDING",
      amountMinor,
      orderId: order.id,
      planVersionId: version.id,
      baseMinor,
      rateBps: rules.directRateBps,
      releaseAt: new Date(paidAt.getTime() + rules.holdDays * 864e5),
      details: {
        formula: "floor(baseMinor * rateBps / 10000)",
        planVersion: version.version,
        holdDays: rules.holdDays,
        lines: items.filter((i) => i.commissionable).map((i) => ({ orderItemId: i.id, netMinor: i.netMinor })),
      },
    },
  });
  await post(tx, [{ userId: referrer.id, type: "COMMISSION_EARNED", amountMinor, from: null, to: "PENDING", sourceType: "Order", sourceId: order.id, commissionId: c.id, idempotencyKey: `commission:${c.id}:earned` }]);
  await notify(referrer.id, "New pending commission", `A sale you referred (${order.number}) earned a pending commission. It's approved after the ${rules.holdDays}-day refund window.`, "/dashboard/commissions", tx, "commission");
  return c;
}

type Candidate = { id: string; paidAt: Date | null; planVersionId: string | null };

/** How many orders matureOrders reads per page. */
const MATURE_PAGE = 500;

/**
 * Approves commissions and credits volume for orders whose refund window has passed. Safe to run repeatedly.
 * Reads candidates page by page and only those old enough for the shortest hold period in any plan version,
 * so orders still inside their refund window are never loaded. Plan versions are read once per run.
 */
export async function matureOrders(now = new Date()) {
  const ops = await getOps();
  if (ops.commissionsPaused) return 0;
  const current = await currentPlanVersion();
  const versions = new Map((await prisma.compPlanVersion.findMany()).map((v) => [v.id, rulesOf(v)]));
  const holdOf = (planVersionId: string | null) => (versions.get(planVersionId ?? current.id) ?? rulesOf(current)).holdDays;
  const minHold = Math.min(rulesOf(current).holdDays, ...[...versions.values()].map((r) => r.holdDays));
  const cutoff = new Date(now.getTime() - minHold * 864e5);

  let matured = 0;
  let after: { paidAt: Date; id: string } | null = null;
  for (;;) {
    const candidates: Candidate[] = await prisma.order.findMany({
      where: {
        status: { in: LIVE_PAID }, commissionedAt: null, disputedAt: null, paidAt: { not: null, lte: cutoff },
        ...(after ? { OR: [{ paidAt: { gt: after.paidAt } }, { paidAt: after.paidAt, id: { gt: after.id } }] } : {}),
      },
      select: { id: true, paidAt: true, planVersionId: true },
      orderBy: [{ paidAt: "asc" }, { id: "asc" }],
      take: MATURE_PAGE,
    });
    if (!candidates.length) break;
    const tail = candidates[candidates.length - 1];
    after = { paidAt: tail.paidAt!, id: tail.id };
    matured += await matureBatch(candidates, holdOf, now);
    if (candidates.length < MATURE_PAGE) break;
  }
  return matured;
}

async function matureBatch(candidates: Candidate[], holdOf: (id: string | null) => number, now: Date) {
  let matured = 0;
  for (const o of candidates) {
    if (o.paidAt!.getTime() + holdOf(o.planVersionId) * 864e5 > now.getTime()) continue;
    const done = await prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({ where: { id: o.id, commissionedAt: null, disputedAt: null, status: { in: LIVE_PAID } }, data: { commissionedAt: now } });
      if (claimed.count === 0) return false;
      const order = await tx.order.findUniqueOrThrow({ where: { id: o.id } });
      const pending = await tx.commission.findMany({ where: { orderId: o.id, status: "PENDING" } });
      for (const c of pending) {
        await tx.commission.update({ where: { id: c.id }, data: { status: "APPROVED", approvedAt: now } });
        await post(tx, [{ userId: c.userId, type: "COMMISSION_APPROVED", amountMinor: c.amountMinor - c.reversedMinor, from: "PENDING", to: "AVAILABLE", sourceType: "Order", sourceId: o.id, commissionId: c.id, idempotencyKey: `commission:${c.id}:approved` }]);
        await notify(c.userId, "Commission approved", `Your commission on order ${order.number} is now available to withdraw.`, "/dashboard/commissions", tx, "commission");
      }
      const pv = order.totalPv - order.refundedPv;
      if (order.volumeNodeId && pv > 0) await applyVolume(tx, order.volumeNodeId, order.id, pv);
      return true;
    });
    if (done) matured++;
  }
  return matured;
}

/**
 * After a refund (partial or full) or a lost chargeback: recalculates each direct commission on what is left of
 * the order, with the commission's own rate, and reverses the difference. Also takes back refunded volume.
 * `eventKey` identifies the refund, so running this twice for the same refund changes nothing.
 */
export async function adjustOrderCommissions(tx: Tx, orderId: string, actorId: string | null, reason: string, eventKey: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  const remainingBase = eligibleNet(order.items);
  const fullyRefunded = order.status === "REFUNDED";
  const rows = await tx.commission.findMany({ where: { orderId, type: "DIRECT", status: { in: ["PENDING", "HELD", "APPROVED", "PAID"] } } });
  let reversedTotal = 0;
  for (const c of rows) {
    // Commissions from before rate versioning have no rate stored: scale them by the share of the sale left.
    const originalBase = c.baseMinor ?? eligibleNet(order.items.map((i) => ({ ...i, refundedNetMinor: 0 })));
    const target = fullyRefunded ? 0
      : c.rateBps !== null ? commissionFor(remainingBase, c.rateBps)
      : originalBase > 0 ? Number((BigInt(c.amountMinor) * BigInt(remainingBase)) / BigInt(originalBase)) : 0;
    const delta = c.amountMinor - Math.min(target, c.amountMinor) - c.reversedMinor;
    if (delta <= 0) continue;
    const from = await commissionBucket(tx, c.id);
    if (!from) throw new AppError(`Commission ${c.id} has no ledger balance to reverse.`, 500);
    const reversedMinor = c.reversedMinor + delta;
    const allGone = reversedMinor >= c.amountMinor;
    await tx.commission.update({ where: { id: c.id }, data: { reversedMinor, ...(allGone ? { status: "REVERSED", holdReason: reason } : {}) } });
    await post(tx, [{ userId: c.userId, type: "COMMISSION_REVERSED", amountMinor: delta, from, to: "REVERSED", sourceType: "Order", sourceId: orderId, commissionId: c.id, idempotencyKey: `commission:${c.id}:reversed:${eventKey}`, memo: reason, actorId }]);
    reversedTotal += delta;
    const owes = from === "AVAILABLE" && (await balances(c.userId, tx)).AVAILABLE < 0;
    await notify(
      c.userId,
      allGone ? "Commission reversed" : "Commission reduced",
      `${allGone ? "The" : "Part of the"} commission on order ${order.number} was reversed (${reason.toLowerCase()}).${owes ? " It had already been paid out, so it will be deducted from your future earnings." : ""}`,
      "/dashboard/commissions",
      tx,
      "commission",
    );
  }
  // Volume: once matured, the order should have contributed (total PV − refunded PV). Take back any excess.
  if (order.volumeNodeId) {
    const credited = await tx.volumeEntry.aggregate({ where: { orderId, nodeId: order.volumeNodeId, leg: null }, _sum: { pv: true } });
    const net = credited._sum.pv ?? 0;
    const target = order.commissionedAt ? Math.max(0, order.totalPv - order.refundedPv) : 0;
    if (net > target) await applyVolume(tx, order.volumeNodeId, orderId, -(net - target));
  }
  await audit("commission.adjust", "Order", orderId, actorId, { reason, eventKey, remainingBase, reversedMinor: reversedTotal }, tx);
}

/** Dispute opened: pending commissions on the order are frozen. */
export async function holdOrderCommissions(tx: Tx, orderId: string, reason = DISPUTE_HOLD) {
  const rows = await tx.commission.findMany({ where: { orderId, status: "PENDING" } });
  for (const c of rows) {
    await moveCommission(tx, c.id, "HELD", null, reason, `dispute:${randomUUID()}`);
  }
}

/** Dispute won: commissions held for the dispute go back to where they were. */
export async function releaseOrderCommissions(tx: Tx, orderId: string, reason = DISPUTE_HOLD) {
  const rows = await tx.commission.findMany({ where: { orderId, status: "HELD", holdReason: reason } });
  for (const c of rows) await moveCommission(tx, c.id, "RELEASE", null, null, `dispute-release:${randomUUID()}`);
}

/** Moves one commission into or out of HELD, with the matching ledger entry. */
async function moveCommission(tx: Tx, id: string, action: "HELD" | "RELEASE", actorId: string | null, reason: string | null, key: string) {
  const c = await tx.commission.findUniqueOrThrow({ where: { id }, include: { order: true } });
  const amount = c.amountMinor - c.reversedMinor;
  if (action === "HELD") {
    const from = c.status === "PENDING" ? "PENDING" : "AVAILABLE";
    const moved = await tx.commission.updateMany({ where: { id, status: c.status }, data: { status: "HELD", holdReason: reason ?? "Held for review" } });
    if (moved.count === 0) throw new AppError("This commission was just changed. Please reload.", 409);
    await post(tx, [{ userId: c.userId, type: "COMMISSION_HELD", amountMinor: amount, from, to: "HELD", sourceType: "Commission", sourceId: id, commissionId: id, idempotencyKey: `commission:${id}:held:${key}`, memo: reason, actorId }]);
    return;
  }
  // A direct commission whose order hasn't matured goes back to pending; matureOrders approves it later.
  const approved = c.type !== "DIRECT" || !!c.order?.commissionedAt;
  const moved = await tx.commission.updateMany({
    where: { id, status: "HELD" },
    data: approved ? { status: "APPROVED", approvedAt: c.approvedAt ?? new Date(), holdReason: null } : { status: "PENDING", holdReason: null },
  });
  if (moved.count === 0) throw new AppError("This commission was just changed. Please reload.", 409);
  await post(tx, [{ userId: c.userId, type: "COMMISSION_RELEASED", amountMinor: amount, from: "HELD", to: approved ? "AVAILABLE" : "PENDING", sourceType: "Commission", sourceId: id, commissionId: id, idempotencyKey: `commission:${id}:released:${key}`, actorId }]);
}

/** Admin hold / release on a single commission (e.g. suspicious activity). */
export async function setCommissionHold(id: string, hold: boolean, actorId: string, reason?: string) {
  return prisma.$transaction(async (tx) => {
    const c = await tx.commission.findUniqueOrThrow({ where: { id }, include: { order: true } });
    if (c.amountMinor <= 0) throw new AppError("Deductions can't be held.");
    if (hold) {
      if (!["PENDING", "APPROVED"].includes(c.status)) throw new AppError("Only pending or approved commissions can be held.");
      if (c.status === "APPROVED") {
        // Approved money may already have been withdrawn: only hold what is still in the wallet.
        await lockWallet(tx, c.userId);
        const { AVAILABLE } = await balances(c.userId, tx);
        if (AVAILABLE < c.amountMinor - c.reversedMinor) throw new AppError("This commission has already been withdrawn, so it can't be held. Use a correction instead.");
      }
      await moveCommission(tx, id, "HELD", actorId, reason || "Held for review", `admin:${randomUUID()}`);
    } else {
      if (c.status !== "HELD") throw new AppError("This commission isn't held.");
      if (c.order?.disputedAt) throw new AppError("The order has an open dispute.");
      await moveCommission(tx, id, "RELEASE", actorId, null, `admin:${randomUUID()}`);
    }
    await audit(hold ? "commission.hold" : "commission.release", "Commission", id, actorId, { reason: reason ?? null, privileged: true }, tx);
  });
}

/** Qualification rules for earning binary. */
export async function isQualified(tx: Tx, node: AffiliateNode, plan: CompPlan) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: node.userId } });
  if (user.status !== "ACTIVE") return false;
  if (node.personalPv < plan.minPersonalPv) return false;
  if (!plan.requireDirectOnEachLeg) return true;

  const children = await tx.affiliateNode.findMany({ where: { parentId: node.id }, select: { id: true, position: true } });
  const childLeg = new Map(children.map((c) => [c.id, c.position]));
  const sponsored = await tx.affiliateNode.findMany({
    where: { user: { sponsorId: node.userId, status: "ACTIVE" }, ancestorIds: { has: node.id } },
    select: { id: true, ancestorIds: true },
  });
  const legs = new Set<string>();
  for (const s of sponsored) {
    const path = [...s.ancestorIds, s.id];
    const leg = childLeg.get(path[path.indexOf(node.id) + 1]);
    if (leg) legs.add(leg);
  }
  return legs.has("LEFT") && legs.has("RIGHT");
}

export class BinaryDisabledError extends AppError {
  constructor() {
    super("Binary matching payouts are switched off in the current compensation plan.");
  }
}

/** How many nodes one binary transaction handles. Small enough to stay well inside the transaction timeout. */
export const BINARY_BATCH = 500;

/**
 * Qualification for a whole batch of nodes in one query (same rules as isQualified).
 * For a sponsored member s below node n, the child of n on s's path is s.ancestorIds[n.depth + 2]
 * (or s itself when s sits directly under n), so the leg comes from that child's position.
 */
export async function qualifiedSet(tx: Tx, ids: string[], plan: CompPlan) {
  const rows = await tx.$queryRaw<{ id: string; base: boolean; hasLeft: boolean; hasRight: boolean }[]>`
    SELECT n.id,
      (u.status::text = 'ACTIVE' AND n."personalPv" >= ${plan.minPersonalPv}) AS base,
      COALESCE(bool_or(c.position::text = 'LEFT'), false) AS "hasLeft",
      COALESCE(bool_or(c.position::text = 'RIGHT'), false) AS "hasRight"
    FROM "AffiliateNode" n
    JOIN "User" u ON u.id = n."userId"
    LEFT JOIN "User" su ON ${plan.requireDirectOnEachLeg} AND su."sponsorId" = n."userId" AND su.status::text = 'ACTIVE'
    LEFT JOIN "AffiliateNode" s ON s."userId" = su.id AND s."ancestorIds"[n.depth + 1] = n.id
    LEFT JOIN "AffiliateNode" c ON c.id = COALESCE(s."ancestorIds"[n.depth + 2], s.id)
    WHERE n.id = ANY(${ids})
    GROUP BY n.id, u.status, n."personalPv"`;
  const out = new Set<string>();
  for (const r of rows) if (r.base && (!plan.requireDirectOnEachLeg || (r.hasLeft && r.hasRight))) out.add(r.id);
  return out;
}

/**
 * Runs binary pairing for every node once per period. A period can never be paid twice.
 * Nodes are handled in batches of BINARY_BATCH, each in its own transaction, so the run scales to any
 * number of members. A node that was paired in this run is marked by its CarryMovement rows; if a run
 * stops part-way (crash, deploy, timeout), calling it again for the same period carries on where it stopped.
 */
export async function runBinary(periodKey: string, actorId: string | null, opts: { batchSize?: number; maxBatches?: number } = {}) {
  const { batchSize = BINARY_BATCH, maxBatches = Infinity } = opts;
  const ops = await getOps();
  if (ops.commissionsPaused) throw new AppError("Commission processing is paused.");
  const version = await currentPlanVersion();
  const plan = rulesOf(version);
  if (!plan.binaryEnabled) throw new BinaryDisabledError();
  const lockKey = `binary:${periodKey}`;

  const run = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const exists = await tx.binaryRun.findUnique({ where: { periodKey } });
    if (exists?.completedAt) throw new AppError(`Binary for ${periodKey} has already been run.`);
    return exists ?? tx.binaryRun.create({ data: { periodKey, actorId, completedAt: null } });
  });

  let cursor = "";
  for (let batch = 0; ; batch++) {
    // maxBatches stops early and leaves the run unfinished (used by tests to check that a run resumes).
    if (batch >= maxBatches) return prisma.binaryRun.findUniqueOrThrow({ where: { id: run.id } });
    const last = await prisma.$transaction(
      async (tx) => {
        // One batch at a time per period, so two overlapping calls can't pair the same node twice.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        const nodes = await tx.$queryRaw<AffiliateNode[]>`
          SELECT n.* FROM "AffiliateNode" n
          WHERE n.id > ${cursor} AND (n."leftCarryPv" > 0 OR n."rightCarryPv" > 0)
            AND NOT EXISTS (SELECT 1 FROM "CarryMovement" m WHERE m."runId" = ${run.id} AND m."nodeId" = n.id)
          ORDER BY n.id LIMIT ${batchSize}
          FOR UPDATE OF n`;
        if (!nodes.length) return null;
        const qualified = await qualifiedSet(tx, nodes.map((n) => n.id), plan);
        let pairsPaid = 0;
        let amountMinor = 0;
        let flushedMinor = 0;
        for (const node of nodes) {
          const r = computePairing({ leftPv: node.leftCarryPv, rightPv: node.rightCarryPv, qualified: qualified.has(node.id) }, plan);
          if (r.leftCarryPv !== node.leftCarryPv || r.rightCarryPv !== node.rightCarryPv) {
            await tx.affiliateNode.update({ where: { id: node.id }, data: { leftCarryPv: r.leftCarryPv, rightCarryPv: r.rightCarryPv } });
            const moves = [
              { leg: "LEFT" as const, pv: r.leftCarryPv - node.leftCarryPv },
              { leg: "RIGHT" as const, pv: r.rightCarryPv - node.rightCarryPv },
            ].filter((m) => m.pv !== 0);
            await tx.carryMovement.createMany({ data: moves.map((m) => ({ ...m, nodeId: node.id, reason: "BINARY_RUN" as const, runId: run.id })) });
          }
          if (r.pairs > 0) {
            pairsPaid += r.pairs;
            amountMinor += r.paidMinor;
            flushedMinor += r.flushedMinor;
            if (r.paidMinor > 0) {
              const c = await tx.commission.create({
                data: {
                  userId: node.userId,
                  type: "BINARY",
                  status: "APPROVED",
                  approvedAt: new Date(),
                  amountMinor: r.paidMinor,
                  runId: run.id,
                  planVersionId: version.id,
                  details: { ...r, periodKey, planVersion: version.version, before: { left: node.leftCarryPv, right: node.rightCarryPv } },
                },
              });
              await post(tx, [{ userId: node.userId, type: "COMMISSION_EARNED", amountMinor: r.paidMinor, from: null, to: "AVAILABLE", sourceType: "BinaryRun", sourceId: run.id, commissionId: c.id, idempotencyKey: `commission:${c.id}:earned` }]);
              await notify(node.userId, "Binary commission", `You matched ${r.pairs} pair(s) for ${periodKey}.`, "/dashboard/commissions", tx, "commission");
            }
          }
        }
        if (pairsPaid || amountMinor || flushedMinor) {
          await tx.binaryRun.update({ where: { id: run.id }, data: { pairsPaid: { increment: pairsPaid }, amountMinor: { increment: amountMinor }, flushedMinor: { increment: flushedMinor } } });
        }
        return nodes[nodes.length - 1].id;
      },
      { timeout: 120_000 },
    );
    if (!last) break;
    cursor = last;
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const current = await tx.binaryRun.findUniqueOrThrow({ where: { id: run.id } });
    if (current.completedAt) return current; // an overlapping call finished it
    const done = await tx.binaryRun.update({ where: { id: run.id }, data: { completedAt: new Date() } });
    await audit("binary.run", "BinaryRun", run.id, actorId, { periodKey, pairsPaid: done.pairsPaid, amountMinor: done.amountMinor, flushedMinor: done.flushedMinor, planVersion: version.version }, tx);
    return done;
  });
}
