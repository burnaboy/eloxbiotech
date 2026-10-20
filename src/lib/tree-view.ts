import { prisma } from "./db";

export interface TreeNodeView {
  id: string;
  name: string;
  referralCode: string;
  status: string;
  leftCount: number;
  rightCount: number;
  leftCarryPv: number;
  rightCarryPv: number;
  personalPv: number;
  /** True when this node is at the edge of what was loaded but has members below it. */
  hasMore: boolean;
  left: TreeNodeView | null;
  right: TreeNodeView | null;
}

/**
 * Loads `levels` levels of the binary tree below `rootNodeId` in a single query (plus one level to know
 * whether the edge nodes have anything below them). Deeper levels load when the viewer moves the focus down.
 */
export async function loadSubtree(rootNodeId: string, levels = 3): Promise<TreeNodeView | null> {
  const root = await prisma.affiliateNode.findUnique({ where: { id: rootNodeId } });
  if (!root) return null;
  const nodes = await prisma.affiliateNode.findMany({
    where: { OR: [{ id: root.id }, { ancestorIds: { has: root.id }, depth: { lte: root.depth + levels + 1 } }] },
    include: { user: { select: { name: true, referralCode: true, status: true } } },
  });
  const byParent = new Map<string, typeof nodes>();
  for (const n of nodes) if (n.parentId) byParent.set(n.parentId, [...(byParent.get(n.parentId) ?? []), n]);
  const build = (n: (typeof nodes)[number]): TreeNodeView => {
    const all = byParent.get(n.id) ?? [];
    const atEdge = n.depth >= root.depth + levels;
    const kids = atEdge ? [] : all;
    const l = kids.find((k) => k.position === "LEFT");
    const r = kids.find((k) => k.position === "RIGHT");
    return {
      id: n.id,
      name: n.user.name,
      referralCode: n.user.referralCode,
      status: n.user.status,
      leftCount: n.leftCount,
      rightCount: n.rightCount,
      leftCarryPv: n.leftCarryPv,
      rightCarryPv: n.rightCarryPv,
      personalPv: n.personalPv,
      hasMore: atEdge && all.length > 0,
      left: l ? build(l) : null,
      right: r ? build(r) : null,
    };
  };
  return build(nodes.find((n) => n.id === root.id)!);
}

export interface MemberHit {
  nodeId: string;
  userId: string;
  name: string;
  referralCode: string;
  depth: number;
  position: string | null;
}

/**
 * Finds members by name, email or referral code. `withinNodeId` limits results to that node's downline,
 * which is how affiliates search: they never see anyone outside their own tree.
 */
export async function searchMembers(q: string, withinNodeId: string | null, take = 20): Promise<MemberHit[]> {
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const rows = await prisma.affiliateNode.findMany({
    where: {
      ...(withinNodeId ? { ancestorIds: { has: withinNodeId } } : {}),
      user: {
        OR: [
          { name: { contains: term, mode: "insensitive" } },
          { referralCode: { equals: term.toUpperCase() } },
          ...(withinNodeId ? [] : [{ email: { contains: term.toLowerCase() } }]),
        ],
      },
    },
    include: { user: { select: { id: true, name: true, referralCode: true } } },
    orderBy: { depth: "asc" },
    take,
  });
  return rows.map((r) => ({ nodeId: r.id, userId: r.user.id, name: r.user.name, referralCode: r.user.referralCode, depth: r.depth, position: r.position }));
}
