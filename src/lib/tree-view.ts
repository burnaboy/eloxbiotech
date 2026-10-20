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
  left: TreeNodeView | null;
  right: TreeNodeView | null;
}

/** Loads `levels` levels of the binary tree below `rootNodeId` in a single query. */
export async function loadSubtree(rootNodeId: string, levels = 3): Promise<TreeNodeView | null> {
  const root = await prisma.affiliateNode.findUnique({ where: { id: rootNodeId } });
  if (!root) return null;
  const nodes = await prisma.affiliateNode.findMany({
    where: { OR: [{ id: root.id }, { ancestorIds: { has: root.id }, depth: { lte: root.depth + levels } }] },
    include: { user: { select: { name: true, referralCode: true, status: true } } },
  });
  const byParent = new Map<string, typeof nodes>();
  for (const n of nodes) if (n.parentId) byParent.set(n.parentId, [...(byParent.get(n.parentId) ?? []), n]);
  const build = (n: (typeof nodes)[number]): TreeNodeView => {
    const kids = byParent.get(n.id) ?? [];
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
      left: l ? build(l) : null,
      right: r ? build(r) : null,
    };
  };
  return build(nodes.find((n) => n.id === root.id)!);
}
