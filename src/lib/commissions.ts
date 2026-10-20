import type { AffiliateNode } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { getCompPlan, type CompPlan } from "./settings";
import { applyVolume } from "./tree";
import { computePairing } from "./binary";
import { audit } from "./audit";

/**
 * Orders earn commissions only after the refund-hold window. This means refunds inside
 * the window never need a clawback. Run on a schedule (see /api/cron).
 */
export async function matureOrders(now = new Date()) {
  const plan = await getCompPlan();
  const cutoff = new Date(now.getTime() - plan.holdDays * 864e5);
  const due = await prisma.order.findMany({
    where: { status: { in: ["PAID", "SHIPPED", "DELIVERED"] }, commissionedAt: null, paidAt: { lte: cutoff } },
    select: { id: true },
    orderBy: { paidAt: "asc" },
  });
  let matured = 0;
  for (const { id } of due) {
    const done = await prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id, commissionedAt: null, status: { in: ["PAID", "SHIPPED", "DELIVERED"] } },
        data: { commissionedAt: now },
      });
      if (claimed.count === 0) return false;
      const order = await tx.order.findUniqueOrThrow({ where: { id } });
      await payDirectBonus(tx, order, plan);
      if (order.volumeNodeId && order.totalPv > 0) await applyVolume(tx, order.volumeNodeId, order.id, order.totalPv);
      return true;
    });
    if (done) matured++;
  }
  return matured;
}

async function payDirectBonus(
  tx: Tx,
  order: { id: string; referrerId: string | null; subtotalMinor: number },
  plan: CompPlan,
) {
  if (!order.referrerId || plan.directBonusPercent <= 0) return;
  const referrer = await tx.user.findUnique({ where: { id: order.referrerId } });
  if (!referrer || referrer.status !== "ACTIVE" || referrer.role === "CUSTOMER") return;
  const amountMinor = Math.floor((order.subtotalMinor * plan.directBonusPercent) / 100);
  if (amountMinor <= 0) return;
  await tx.commission.create({
    data: {
      userId: referrer.id,
      type: "DIRECT",
      amountMinor,
      orderId: order.id,
      details: { percent: plan.directBonusPercent, subtotalMinor: order.subtotalMinor },
    },
  });
}

/** Clawback for a refund after commissions were credited. Paid binary pairs are not unwound; carry volume is reduced. */
export async function reverseOrderCommissions(tx: Tx, orderId: string, actorId: string | null) {
  const direct = await tx.commission.findMany({ where: { orderId, type: "DIRECT", status: "AVAILABLE" } });
  for (const c of direct) {
    await tx.commission.create({
      data: { userId: c.userId, type: "ADJUSTMENT", amountMinor: -c.amountMinor, orderId, note: "Refund clawback", details: { reverses: c.id } },
    });
  }
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.volumeNodeId && order.totalPv > 0) await applyVolume(tx, order.volumeNodeId, orderId, -order.totalPv);
  await audit("commission.reverse", "Order", orderId, actorId, { directCount: direct.length }, tx);
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

/** Runs binary pairing for every node once per period. A period can never be paid twice. */
export async function runBinary(periodKey: string, actorId: string | null) {
  const plan = await getCompPlan();
  return prisma.$transaction(
    async (tx) => {
      const exists = await tx.binaryRun.findUnique({ where: { periodKey } });
      if (exists) throw new AppError(`Binary for ${periodKey} has already been run.`);
      const run = await tx.binaryRun.create({ data: { periodKey, actorId } });

      const nodes = await tx.affiliateNode.findMany({
        where: { OR: [{ leftCarryPv: { gt: 0 } }, { rightCarryPv: { gt: 0 } }] },
      });
      let pairsPaid = 0;
      let amountMinor = 0;
      let flushedMinor = 0;
      for (const node of nodes) {
        const qualified = await isQualified(tx, node, plan);
        const r = computePairing({ leftPv: node.leftCarryPv, rightPv: node.rightCarryPv, qualified }, plan);
        if (r.leftCarryPv !== node.leftCarryPv || r.rightCarryPv !== node.rightCarryPv) {
          await tx.affiliateNode.update({ where: { id: node.id }, data: { leftCarryPv: r.leftCarryPv, rightCarryPv: r.rightCarryPv } });
        }
        if (r.pairs > 0) {
          pairsPaid += r.pairs;
          amountMinor += r.paidMinor;
          flushedMinor += r.flushedMinor;
          if (r.paidMinor > 0) {
            await tx.commission.create({
              data: {
                userId: node.userId,
                type: "BINARY",
                amountMinor: r.paidMinor,
                runId: run.id,
                details: { ...r, periodKey, before: { left: node.leftCarryPv, right: node.rightCarryPv } },
              },
            });
          }
        }
      }
      const done = await tx.binaryRun.update({ where: { id: run.id }, data: { pairsPaid, amountMinor, flushedMinor } });
      await audit("binary.run", "BinaryRun", run.id, actorId, { periodKey, pairsPaid, amountMinor, flushedMinor }, tx);
      return done;
    },
    { timeout: 120_000 },
  );
}
