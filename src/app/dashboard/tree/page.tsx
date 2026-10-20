import Link from "next/link";
import { requireAffiliate } from "@/lib/session";
import { prisma } from "@/lib/db";
import { loadSubtree } from "@/lib/tree-view";
import { BinaryTree } from "@/components/binary-tree";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Binary tree" };

export default async function TreePage({ searchParams }: { searchParams: Promise<{ n?: string }> }) {
  const user = await requireAffiliate();
  const me = await prisma.affiliateNode.findUniqueOrThrow({ where: { userId: user.id } });
  const { n } = await searchParams;
  // You can only browse your own downline.
  let focus = me;
  if (n && n !== me.id) {
    const target = await prisma.affiliateNode.findUnique({ where: { id: n } });
    if (target && target.ancestorIds.includes(me.id)) focus = target;
  }
  const tree = await loadSubtree(focus.id, 3);
  const parentInScope = focus.id !== me.id && focus.parentId;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Binary tree</h1>
        <div className="flex gap-2">
          {parentInScope && <Button asChild variant="outline" size="sm"><Link href={`/dashboard/tree?n=${focus.parentId}`}>Up one level</Link></Button>}
          {focus.id !== me.id && <Button asChild variant="outline" size="sm"><Link href="/dashboard/tree">Back to me</Link></Button>}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">Click a member to view their part of your tree. Counts show members and current unpaired PV on each side.</p>
      {tree && <BinaryTree root={tree} basePath="/dashboard/tree" />}
    </>
  );
}
