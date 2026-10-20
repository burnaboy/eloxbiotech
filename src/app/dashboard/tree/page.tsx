import Link from "next/link";
import { requireAffiliate } from "@/lib/session";
import { prisma } from "@/lib/db";
import { loadSubtree, searchMembers } from "@/lib/tree-view";
import { BinaryTree } from "@/components/binary-tree";
import { Button } from "@/components/ui/button";
import { MemberSearch } from "@/components/member-search";
import { PendingPlacement } from "@/components/pending-placement";

export const metadata = { title: "Binary tree" };

export default async function TreePage({ searchParams }: { searchParams: Promise<{ n?: string; q?: string }> }) {
  const user = await requireAffiliate();
  const me = await prisma.affiliateNode.findUnique({ where: { userId: user.id } });
  if (!me) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Binary tree</h1>
        <PendingPlacement requestedLeg={user.requestedLeg} />
      </>
    );
  }
  const { n, q } = await searchParams;
  // Affiliates can only browse and search their own downline; any other id falls back to their own position.
  let focus = me;
  if (n && n !== me.id) {
    const target = await prisma.affiliateNode.findUnique({ where: { id: n } });
    if (target && target.ancestorIds.includes(me.id)) focus = target;
  }
  const [tree, hits] = await Promise.all([loadSubtree(focus.id, 3), q ? searchMembers(q, me.id) : null]);
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
      <MemberSearch q={q} hits={hits} basePath="/dashboard/tree" placeholder="Name or code in your team" />
      <p className="text-sm text-muted-foreground">
        Three levels show at a time. Select a member to open their part of your tree. Counts show members and current unpaired PV on each side.
        A position in the tree doesn't earn anything by itself; only completed product sales create volume.
      </p>
      {tree && <BinaryTree root={tree} basePath="/dashboard/tree" />}
    </>
  );
}
