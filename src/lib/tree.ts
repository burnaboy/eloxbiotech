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

/**
 * Finds the bottom of the outside edge of `leg` under `start` (the first node with no child on that leg).
 * One recursive query instead of one query per level, so a long spillover edge stays cheap. Each step uses
 * the unique (parentId, position) index.
 */
export async function outermostSlot(tx: Tx, start: AffiliateNode, leg: Leg) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE edge AS (
      SELECT n.id, 0 AS steps FROM "AffiliateNode" n WHERE n.id = ${start.id}
      UNION ALL
      SELECT c.id, e.steps + 1 FROM edge e
      JOIN "AffiliateNode" c ON c."parentId" = e.id AND c.position = ${leg}::"Leg"
      WHERE e.steps < 100000
    )
    SELECT id FROM edge ORDER BY steps DESC LIMIT 1`;
  if (!rows[0]) throw new Error("Placement start node not found");
  return rows[0].id === start.id ? start : tx.affiliateNode.findUniqueOrThrow({ where: { id: rows[0].id } });
}

export interface PlaceOptions {
  method?: "AUTO" | "SPONSOR_CHOICE" | "ADMIN";
  actorId?: string | null;
  /** Admin placement: put the member directly under this node, on `requestedLeg`. */
  parentNodeId?: string;
  note?: string;
}

/**
 * Places a new affiliate in the binary tree under their sponsor.
 * - Normal: the sponsor's chosen leg (or the plan default), spilling over to the bottom of that leg's outside edge.
 * - Admin: an exact open slot, which must be the sponsor's own position or somewhere in the sponsor's downline.
 * Placements are permanent (enforced by database triggers) and each one is recorded in PlacementRecord.
 * Must run inside a transaction.
 */
export async function placeInTree(tx: Tx, userId: string, sponsorUserId: string | null, requestedLeg?: Leg | null, opts: PlaceOptions = {}) {
  if (sponsorUserId && sponsorUserId === userId) throw new AppError("A member can't sponsor themselves.");
  await lockTree(tx);
  const existing = await tx.affiliateNode.findUnique({ where: { userId } });
  if (existing) {
    if (opts.method === "ADMIN") throw new AppError("This member already has a position. Placements can't be changed.");
    return existing;
  }

  const root = await tx.affiliateNode.findFirst({ where: { parentId: null } });
  if (!root) {
    const node = await tx.affiliateNode.create({ data: { userId, depth: 0, ancestorIds: [] } });
    await tx.placementRecord.create({ data: { nodeId: node.id, userId, sponsorId: sponsorUserId, method: opts.method ?? "AUTO", actorId: opts.actorId ?? null, note: "Network root" } });
    return node;
  }

  let sponsorNode = sponsorUserId ? await tx.affiliateNode.findUnique({ where: { userId: sponsorUserId } }) : null;
  if (sponsorUserId && !sponsorNode) throw new AppError("Your sponsor is not an active affiliate.");
  sponsorNode ??= root;

  let parent: AffiliateNode;
  let leg: Leg;
  if (opts.method === "ADMIN") {
    if (!opts.parentNodeId || !requestedLeg) throw new AppError("Choose a parent and a side.");
    const p = await tx.affiliateNode.findUnique({ where: { id: opts.parentNodeId } });
    if (!p) throw new AppError("That parent position doesn't exist.");
    if (p.id !== sponsorNode.id && !p.ancestorIds.includes(sponsorNode.id)) {
      throw new AppError("The new position must be in the sponsor's own downline.");
    }
    const taken = await tx.affiliateNode.findUnique({ where: { parentId_position: { parentId: p.id, position: requestedLeg } } });
    if (taken) throw new AppError(`The ${requestedLeg.toLowerCase()} position under that member is already filled.`);
    parent = p;
    leg = requestedLeg;
  } else {
    let chosen: Leg | null = requestedLeg ?? sponsorNode.defaultLeg;
    if (!chosen) {
      const plan = await getCompPlan(tx);
      if (plan.defaultPlacement === "WEAKER_LEG") chosen = sponsorNode.rightCount < sponsorNode.leftCount ? "RIGHT" : "LEFT";
      else chosen = plan.defaultPlacement;
    }
    leg = chosen;
    parent = await outermostSlot(tx, sponsorNode, leg);
  }

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
  await tx.placementRecord.create({
    data: {
      nodeId: node.id, userId, sponsorId: sponsorUserId, parentId: parent.id, position: leg,
      method: opts.method ?? (requestedLeg ? "SPONSOR_CHOICE" : "AUTO"), actorId: opts.actorId ?? null, note: opts.note ?? null,
    },
  });
  await tx.user.update({ where: { id: userId }, data: { placementPending: false, requestedLeg: null } });

  const legs = await ancestorLegs(tx, node);
  const left = legs.filter((l) => l.leg === "LEFT").map((l) => l.ancestorId);
  const right = legs.filter((l) => l.leg === "RIGHT").map((l) => l.ancestorId);
  if (left.length) await tx.affiliateNode.updateMany({ where: { id: { in: left } }, data: { leftCount: { increment: 1 } } });
  if (right.length) await tx.affiliateNode.updateMany({ where: { id: { in: right } }, data: { rightCount: { increment: 1 } } });
  return node;
}

/** Open slots an admin could choose for a pending member: the outside edge of each of the sponsor's legs. */
export async function suggestedSlots(tx: Tx, sponsorUserId: string | null) {
  const sponsorNode = sponsorUserId
    ? await tx.affiliateNode.findUnique({ where: { userId: sponsorUserId } })
    : await tx.affiliateNode.findFirst({ where: { parentId: null } });
  if (!sponsorNode) return [];
  const out: { parentId: string; leg: Leg }[] = [];
  for (const leg of ["LEFT", "RIGHT"] as const) {
    const p = await outermostSlot(tx, sponsorNode, leg);
    out.push({ parentId: p.id, leg });
  }
  return out;
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
    if (pv < 0) {
      // A reversal larger than what's left in carry (because it was already paired) stops at zero.
      // Record the difference so carry still reconciles against the ledger.
      const col = side === "LEFT" ? "leftCarryPv" : "rightCarryPv";
      const short = await tx.affiliateNode.findMany({ where: { id: { in: ids }, [col]: { lt: -pv } }, select: { id: true, leftCarryPv: true, rightCarryPv: true } });
      if (short.length) {
        await tx.carryMovement.createMany({
          data: short.map((n) => ({ nodeId: n.id, leg: side, pv: -pv - (side === "LEFT" ? n.leftCarryPv : n.rightCarryPv), reason: "REVERSAL_FLOOR" as const, orderId })),
        });
      }
    }
    if (side === "LEFT") {
      await tx.$executeRaw`UPDATE "AffiliateNode" SET "leftCarryPv" = GREATEST(0, "leftCarryPv" + ${pv}), "leftTotalPv" = GREATEST(0, "leftTotalPv" + ${pv}) WHERE id = ANY(${ids})`;
    } else {
      await tx.$executeRaw`UPDATE "AffiliateNode" SET "rightCarryPv" = GREATEST(0, "rightCarryPv" + ${pv}), "rightTotalPv" = GREATEST(0, "rightTotalPv" + ${pv}) WHERE id = ANY(${ids})`;
    }
    await tx.volumeEntry.createMany({ data: ids.map((nodeId) => ({ nodeId, orderId, leg: side, pv })) });
  }
}

/**
 * Open slots an admin can choose for a pending member: the outside edge of each of the sponsor's legs,
 * plus every free slot within the first `levels` levels under the sponsor (all inside the sponsor's downline).
 */
export async function openSlotsForSponsor(tx: Tx, sponsorUserId: string | null, levels = 3, limit = 30) {
  const sponsorNode = sponsorUserId
    ? await tx.affiliateNode.findUnique({ where: { userId: sponsorUserId } })
    : await tx.affiliateNode.findFirst({ where: { parentId: null } });
  if (!sponsorNode) return [];
  const edge = await suggestedSlots(tx, sponsorUserId);
  const near = await tx.affiliateNode.findMany({
    where: { OR: [{ id: sponsorNode.id }, { ancestorIds: { has: sponsorNode.id }, depth: { lt: sponsorNode.depth + levels } }] },
    select: { id: true, depth: true, children: { select: { position: true } } },
    orderBy: { depth: "asc" },
  });
  const out = new Map<string, { parentId: string; leg: Leg; outerEdge: boolean }>();
  for (const s of edge) out.set(`${s.parentId}:${s.leg}`, { ...s, outerEdge: true });
  for (const n of near) {
    for (const leg of ["LEFT", "RIGHT"] as const) {
      if (!n.children.some((c) => c.position === leg) && out.size < limit) {
        const k = `${n.id}:${leg}`;
        if (!out.has(k)) out.set(k, { parentId: n.id, leg, outerEdge: false });
      }
    }
  }
  return [...out.values()];
}
