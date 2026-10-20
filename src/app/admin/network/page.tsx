import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { loadSubtree } from "@/lib/tree-view";
import { BinaryTree } from "@/components/binary-tree";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";

export default async function Network({ searchParams }: { searchParams: Promise<{ n?: string; code?: string }> }) {
  await requireAdmin("NETWORK");
  const sp = await searchParams;
  let focusId = sp.n;
  let notFoundCode = false;
  if (sp.code) {
    const u = await prisma.user.findUnique({ where: { referralCode: sp.code.trim().toUpperCase() }, include: { node: true } });
    if (u?.node) focusId = u.node.id;
    else notFoundCode = true;
  }
  const root = focusId ? await prisma.affiliateNode.findUnique({ where: { id: focusId } }) : await prisma.affiliateNode.findFirst({ where: { parentId: null } });
  const tree = root ? await loadSubtree(root.id, 3) : null;
  const stats = await prisma.affiliateNode.aggregate({ _count: true, _max: { depth: true } });
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Network</h1>
      <p className="text-sm text-muted-foreground">{stats._count} positions, {stats._max.depth ?? 0} levels deep.</p>
      <form className="flex gap-2">
        <Input name="code" placeholder="Jump to member code" className="max-w-xs" aria-label="Member code" defaultValue={sp.code} />
        <Button variant="outline">Go</Button>
        {root?.parentId && <Button asChild variant="ghost"><Link href={`?n=${root.parentId}`}>Up one level</Link></Button>}
        {root?.parentId && <Button asChild variant="ghost"><Link href="?">Top</Link></Button>}
      </form>
      {notFoundCode && <Alert tone="error">No affiliate with that code.</Alert>}
      {tree ? <BinaryTree root={tree} basePath="/admin/network" /> : <Alert>The network is empty.</Alert>}
    </>
  );
}
