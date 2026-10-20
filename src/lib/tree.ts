import type { AffiliateNode, Leg } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { Tx } from "./db";
import { AppError } from "./errors";
import { getCompPlan } from "./settings";

/** Serialises tree writes so two sign-ups can never take the same slot. */
const TREE_LOCK = 7_310_001;

export async function lockTree(tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TREE_LOCK})`;
}

/** For each ancestor of `node`, which of that ancestor's legs `node` sits under. */
export async function ancestorLegs(tx: Tx, node: Pick<AffiliateNode, "id" | "ancestorIds">) {
  const path = [...node.ancestorIds, node.id];
  const rows = await tx.affiliateNode.findMany({ where: { id: { in: path } }, select: { id: true, position: true } });
  const pos = new Map(rows.map((r) => [r.id, r.position]));
  const out: { ancestorId: string; leg: Leg }[] = [];
  for (let i = 0; i < node.ancestorIds.length; i++) {
    const leg = pos.get(path[i + 1]);
    if (!leg) throw new Error(`Tree is inconsistent at ${path[i + 1]}`);
    out.push({ ancestorId: path[i], leg });
  }
  return out;
}

/** Walks down the outside edge of `leg` under `start` to the first empty slot. */
export async function outermostSlot(tx: Tx, start: AffiliateNode, leg: Leg) {
  let parent = start;
  for (let guard = 0; guard < 100_000; guard++) {
    const child = await tx.affiliateNode.findUnique({ where: { parentId_position: { parentId: parent.id, position: leg } } });
    if (!child) return parent;
    parent = child;
  }
  throw new Error("Tree depth limit reached");
}

/**
 * Places a new affiliate in the binary tree under their sponsor.
 * The sponsor picks a leg (or the plan default applies); the new member spills over
 * to the bottom of the outside edge of that leg.
 * Must run inside a transaction.
 */
export async function placeInTree(tx: Tx, userId: string, sponsorUserId: string | null, requestedLeg?: Leg | null) {
  await lockTree(tx);
  const existing = await tx.affiliateNode.findUnique({ where: { userId } });
  if (existing) return existing;

  const root = await tx.affiliateNode.findFirst({ where: { parentId: null } });
  if (!root) {
    return tx.affiliateNode.create({ data: { userId, depth: 0, ancestorIds: [] } });
  }

  let sponsorNode = sponsorUserId ? await tx.affiliateNode.findUnique({ where: { userId: sponsorUserId } }) : null;
  if (sponsorUserId && !sponsorNode) throw new AppError("Your sponsor is not an active affiliate.");
  sponsorNode ??= root;

  let leg: Leg | null = requestedLeg ?? sponsorNode.defaultLeg;
  if (!leg) {
    const plan = await getCompPlan(tx);
    if (plan.defaultPlacement === "WEAKER_LEG") leg = sponsorNode.rightCount < sponsorNode.leftCount ? "RIGHT" : "LEFT";
    else leg = plan.defaultPlacement;
  }

  const parent = await outermostSlot(tx, sponsorNode, leg);
  let node: AffiliateNode;
  try {
    node = await tx.affiliateNode.create({
      data: { userId, parentId: parent.id, position: leg, depth: parent.depth + 1, ancestorIds: [...parent.ancestorIds, parent.id] },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError("That position was just taken. Please try again.", 409);
    }
    throw e;
  }

  const legs = await ancestorLegs(tx, node);
  const left = legs.filter((l) => l.leg === "LEFT").map((l) => l.ancestorId);
  const right = legs.filter((l) => l.leg === "RIGHT").map((l) => l.ancestorId);
  if (left.length) await tx.affiliateNode.updateMany({ where: { id: { in: left } }, data: { leftCount: { increment: 1 } } });
  if (right.length) await tx.affiliateNode.updateMany({ where: { id: { in: right } }, data: { rightCount: { increment: 1 } } });
  return node;
}

/**
 * Credits (or with negative pv, reverses) an order's PV: personal volume on the source node,
 * and leg volume on every ancestor. Carry never goes below zero.
 */
export async function applyVolume(tx: Tx, sourceNodeId: string, orderId: string, pv: number) {
  if (pv === 0) return;
  const source = await tx.affiliateNode.findUniqueOrThrow({ where: { id: sourceNodeId } });
  await tx.$executeRaw`UPDATE "AffiliateNode" SET "personalPv" = GREATEST(0, "personalPv" + ${pv}) WHERE id = ${source.id}`;
  await tx.volumeEntry.create({ data: { nodeId: source.id, orderId, leg: null, pv } });

  const legs = await ancestorLegs(tx, source);
  for (const side of ["LEFT", "RIGHT"] as const) {
    const ids = legs.filter((l) => l.leg === side).map((l) => l.ancestorId);
    if (!ids.length) continue;
    if (side === "LEFT") {
      await tx.$executeRaw`UPDATE "AffiliateNode" SET "leftCarryPv" = GREATEST(0, "leftCarryPv" + ${pv}), "leftTotalPv" = GREATEST(0, "leftTotalPv" + ${pv}) WHERE id = ANY(${ids})`;
    } else {
      await tx.$executeRaw`UPDATE "AffiliateNode" SET "rightCarryPv" = GREATEST(0, "rightCarryPv" + ${pv}), "rightTotalPv" = GREATEST(0, "rightTotalPv" + ${pv}) WHERE id = ANY(${ids})`;
    }
    await tx.volumeEntry.createMany({ data: ids.map((nodeId) => ({ nodeId, orderId, leg: side, pv })) });
  }
}
