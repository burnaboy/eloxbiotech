import type { AffiliateNode, Order } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { getCompPlan, getOps, type CompPlan } from "./settings";
import { applyVolume } from "./tree";
import { computePairing } from "./binary";
import { audit } from "./audit";
import { notify } from "./notify";

/*
 * Commission lifecycle
 *   order paid          -> DIRECT commission PENDING (releaseAt = paid + holdDays)
 *   dispute opened      -> PENDING becomes HELD
 *   hold window passes  -> PENDING becomes APPROVED, order volume enters the binary tree
 *   refund / chargeback -> PENDING/HELD/unpaid APPROVED become REVERSED; paid ones get a negative ADJUSTMENT
 *   payout completed    -> APPROVED commissions are marked PAID oldest first
 * Binary commissions are created APPROVED, because they only ever pair matured volume.
 */

const PAID_STATES = ["PAID", "SHIPPED", "DELIVERED"] as const;

/** Called in the same transaction that marks an order PAID. */
export async function onOrderPaid(tx: Tx, order: Pick<Order, "id" | "number" | "referrerId" | "subtotalMinor" | "paidAt">) {
  const plan = await getCompPlan(tx);
  if (!order.referrerId || plan.directBonusPercent <= 0) return;
  const referrer = await tx.user.findUnique({ where: { id: order.referrerId } });
  if (!referrer || referrer.status !== "ACTIVE" || referrer.role === "CUSTOMER") return;
  const amountMinor = Math.floor((order.subtotalMinor * plan.directBonusPercent) / 100);
  if (amountMinor <= 0) return;
  const paidAt = order.paidAt ?? new Date();
  await tx.commission.create({
    data: {
      userId: referrer.id,
      type: "DIRECT",
      status: "PENDING",
      amountMinor,
      orderId: order.id,
      releaseAt: new Date(paidAt.getTime() + plan.holdDays * 864e5),
      details: { percent: plan.directBonusPercent, subtotalMinor: order.subtotalMinor },
    },
  });
  await notify(referrer.id, "New pending commission", `A sale you referred (${order.number}) earned a pending commission. It's approved after the ${plan.holdDays}-day refund window.`, "/dashboard/commissions", tx, "commission");
}

/** Approves commissions and credits volume for orders whose refund window has passed. */
export async function matureOrders(now = new Date()) {
  const [plan, ops] = await Promise.all([getCompPlan(), getOps()]);
  if (ops.commissionsPaused) return 0;
  const cutoff = new Date(now.getTime() - plan.holdDays * 864e5);
  const due = await prisma.order.findMany({
    where: { status: { in: [...PAID_STATES] }, commissionedAt: null, disputedAt: null, paidAt: { lte: cutoff } },
    select: { id: true },
    orderBy: { paidAt: "asc" },
  });
  let matured = 0;
  for (const { id } of due) {
    const done = await prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id, commissionedAt: null, disputedAt: null, status: { in: [...PAID_STATES] } },
        data: { commissionedAt: now },
      });
      if (claimed.count === 0) return false;
      const order = await tx.order.findUniqueOrThrow({ where: { id } });
      const pending = await tx.commission.findMany({ where: { orderId: id, status: "PENDING" } });
      for (const c of pending) {
        await tx.commission.update({ where: { id: c.id }, data: { status: "APPROVED", approvedAt: now } });
        await notify(c.userId, "Commission approved", `Your commission on order ${order.number} is now available to withdraw.`, "/dashboard/commissions", tx, "commission");
      }
      if (order.volumeNodeId && order.totalPv > 0) await applyVolume(tx, order.volumeNodeId, order.id, order.totalPv);
      return true;
    });
    if (done) matured++;
  }
  return matured;
}

/** Reverses everything an order earned. Used for refunds and lost chargebacks. */
export async function reverseOrderCommissions(tx: Tx, orderId: string, actorId: string | null, reason: string) {
  const rows = await tx.commission.findMany({ where: { orderId, type: "DIRECT", status: { in: ["PENDING", "HELD", "APPROVED", "PAID"] } } });
  for (const c of rows) {
    if (c.status !== "PAID" && c.paidMinor === 0) {
      await tx.commission.update({ where: { id: c.id }, data: { status: "REVERSED", holdReason: reason } });
    } else {
      // Already (partly) paid out: recover it from future earnings.
      await tx.commission.create({
        data: { userId: c.userId, type: "ADJUSTMENT", status: "APPROVED", approvedAt: new Date(), amountMinor: -c.amountMinor, orderId, note: `${reason} clawback`, details: { reverses: c.id } },
      });
    }
    await notify(c.userId, "Commission reversed", `The commission on a referred order was reversed (${reason.toLowerCase()}).`, "/dashboard/commissions", tx, "commission");
  }
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.commissionedAt && order.volumeNodeId && order.totalPv > 0) await applyVolume(tx, order.volumeNodeId, orderId, -order.totalPv);
  await audit("commission.reverse", "Order", orderId, actorId, { count: rows.length, reason }, tx);
}

export async function holdOrderCommissions(tx: Tx, orderId: string, reason: string) {
  await tx.commission.updateMany({ where: { orderId, status: "PENDING" }, data: { status: "HELD", holdReason: reason } });
}

export async function releaseOrderCommissions(tx: Tx, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  // Not yet matured -> back to pending; matureOrders approves it when the window passes.
  await tx.commission.updateMany({
    where: { orderId, status: "HELD" },
    data: order.commissionedAt ? { status: "APPROVED", approvedAt: new Date(), holdReason: null } : { status: "PENDING", holdReason: null },
  });
}

/** Admin hold / release on a single commission (e.g. suspicious activity). */
export async function setCommissionHold(id: string, hold: boolean, actorId: string, reason?: string) {
  return prisma.$transaction(async (tx) => {
    const c = await tx.commission.findUniqueOrThrow({ where: { id }, include: { order: true } });
    if (hold) {
      if (!["PENDING", "APPROVED"].includes(c.status) || c.paidMinor > 0) throw new AppError("Only unpaid pending or approved commissions can be held.");
      if (c.amountMinor < 0) throw new AppError("Deductions can't be held.");
      await tx.commission.update({ where: { id }, data: { status: "HELD", holdReason: reason || "Held for review" } });
    } else {
      if (c.status !== "HELD") throw new AppError("This commission isn't held.");
      if (c.order?.disputedAt) throw new AppError("The order has an open dispute.");
      const approved = c.type !== "DIRECT" || !!c.order?.commissionedAt;
      await tx.commission.update({ where: { id }, data: approved ? { status: "APPROVED", approvedAt: new Date(), holdReason: null } : { status: "PENDING", holdReason: null } });
    }
    await audit(hold ? "commission.hold" : "commission.release", "Commission", id, actorId, { reason: reason ?? null }, tx);
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

/** Runs binary pairing for every node once per period. A period can never be paid twice. */
export async function runBinary(periodKey: string, actorId: string | null) {
  const [plan, ops] = await Promise.all([getCompPlan(), getOps()]);
  if (ops.commissionsPaused) throw new AppError("Commission processing is paused.");
  return prisma.$transaction(
    async (tx) => {
      const exists = await tx.binaryRun.findUnique({ where: { periodKey } });
      if (exists) throw new AppError(`Binary for ${periodKey} has already been run.`);
      const run = await tx.binaryRun.create({ data: { periodKey, actorId } });

      const nodes = await tx.affiliateNode.findMany({ where: { OR: [{ leftCarryPv: { gt: 0 } }, { rightCarryPv: { gt: 0 } }] } });
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
                status: "APPROVED",
                approvedAt: new Date(),
                amountMinor: r.paidMinor,
                runId: run.id,
                details: { ...r, periodKey, before: { left: node.leftCarryPv, right: node.rightCarryPv } },
              },
            });
            await notify(node.userId, "Binary commission", `You matched ${r.pairs} pair(s) for ${periodKey}.`, "/dashboard/commissions", tx, "commission");
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
