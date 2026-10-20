import { requireAffiliate } from "@/lib/session";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Empty, TBody, THead, Table, Td, Th } from "@/components/ui/table";
import { Pager } from "@/components/admin/pager";
import { pageOf } from "@/lib/admin-filters";

const PAGE = 50;

export const metadata = { title: "My referrals" };

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = pageOf((await searchParams).page);
  const user = await requireAffiliate();
  const me = await prisma.affiliateNode.findUnique({ where: { userId: user.id } });
  const [refs, children] = await Promise.all([
    prisma.user.findMany({ where: { sponsorId: user.id }, select: { id: true, name: true, role: true, createdAt: true, placementPending: true, node: { select: { id: true, ancestorIds: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE + 1 }),
    me ? prisma.affiliateNode.findMany({ where: { parentId: me.id }, select: { id: true, position: true } }) : [],
  ]);
  const childLeg = new Map(children.map((c) => [c.id, c.position]));
  const sideOf = (ancestorIds: string[], id: string) => {
    const path = [...ancestorIds, id];
    if (!me) return null;
    return childLeg.get(path[path.indexOf(me.id) + 1]) ?? null;
  };
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">My referrals</h1>
      <p className="text-sm text-muted-foreground">People who signed up with your link. Customers buy through you; affiliates are also placed in your tree.</p>
      {refs.length === 0 ? <Empty>No referrals yet.</Empty> : (
        <Table>
          <THead><tr><Th>Name</Th><Th>Type</Th><Th>Side</Th><Th>Joined</Th></tr></THead>
          <TBody>
            {refs.slice(0, PAGE).map((r) => (
              <tr key={r.id}>
                <Td className="font-medium">{r.name}</Td>
                <Td><Badge tone={r.role === "CUSTOMER" ? "neutral" : "primary"}>{r.role === "CUSTOMER" ? "customer" : "affiliate"}</Badge></Td>
                <Td>{r.node ? (sideOf(r.node.ancestorIds, r.node.id)?.toLowerCase() ?? "—") : r.placementPending ? "awaiting placement" : "—"}</Td>
                <Td>{formatDate(r.createdAt)}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      <Pager page={page} hasMore={refs.length > PAGE} params={{}} />
    </>
  );
}
