import Link from "next/link";
import { ReasonFields } from "@/components/admin/high-risk";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { loadSubtree, searchMembers } from "@/lib/tree-view";
import { openSlotsForSponsor } from "@/lib/tree";
import { getCompPlan } from "@/lib/settings";
import { formatDate } from "@/lib/utils";
import { BinaryTree } from "@/components/binary-tree";
import { MemberSearch } from "@/components/member-search";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Flash } from "@/components/flash";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, THead, Table, Td, Th } from "@/components/ui/table";
import { placeMemberAction } from "../actions";

const methodLabel = { AUTO: "automatic", SPONSOR_CHOICE: "sponsor's side", ADMIN: "admin" } as const;

export default async function Network({ searchParams }: { searchParams: Promise<{ n?: string; q?: string; ok?: string; error?: string }> }) {
  await requireAdmin("NETWORK");
  const sp = await searchParams;
  const plan = await getCompPlan();
  const root = sp.n ? await prisma.affiliateNode.findUnique({ where: { id: sp.n } }) : await prisma.affiliateNode.findFirst({ where: { parentId: null } });
  const [tree, hits, stats, pending, recent] = await Promise.all([
    root ? loadSubtree(root.id, 3) : null,
    sp.q ? searchMembers(sp.q, null) : null,
    prisma.affiliateNode.aggregate({ _count: true, _max: { depth: true } }),
    prisma.user.findMany({ where: { placementPending: true }, include: { sponsor: { select: { name: true, referralCode: true } } }, orderBy: { createdAt: "asc" }, take: 25 }),
    prisma.placementRecord.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const slotsByUser = new Map(await Promise.all(pending.map(async (u) => [u.id, await openSlotsForSponsor(prisma, u.sponsorId)] as const)));
  const nodeIds = [...new Set([...[...slotsByUser.values()].flat().map((s) => s.parentId), ...recent.map((r) => r.parentId).filter((x): x is string => !!x)])];
  const userIds = [...new Set([...recent.map((r) => r.userId), ...recent.map((r) => r.actorId).filter((x): x is string => !!x)])];
  const [slotNodes, people] = await Promise.all([
    prisma.affiliateNode.findMany({ where: { id: { in: nodeIds } }, select: { id: true, depth: true, user: { select: { name: true, referralCode: true } } } }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
  ]);
  const nodeName = new Map(slotNodes.map((n) => [n.id, `${n.user.name} (${n.user.referralCode}, level ${n.depth})`]));
  const personName = new Map(people.map((p) => [p.id, p.name]));

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Network</h1>
      <Flash sp={sp} />
      <p className="text-sm text-muted-foreground">
        {stats._count} positions, {stats._max.depth ?? 0} levels deep. New affiliates are placed{" "}
        {plan.placementMode === "ADMIN_APPROVAL" ? <strong>by an administrator</strong> : <strong>automatically</strong>} (change this in Settings).
        Placements are permanent once made.
      </p>

      {(pending.length > 0 || plan.placementMode === "ADMIN_APPROVAL") && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">Waiting for placement <Badge tone={pending.length ? "warning" : "success"}>{pending.length}</Badge></CardTitle>
            <CardDescription>Positions must be inside the sponsor's own downline. Placing someone pays nobody anything. You'll be asked for an authenticator code.</CardDescription>
          </CardHeader>
          <CardContent>
            {pending.length === 0 ? <p className="text-sm text-muted-foreground">Nobody is waiting.</p> : (
              <ul className="divide-y">
                {pending.map((u) => {
                  const slots = slotsByUser.get(u.id) ?? [];
                  const preferred = slots.find((s) => s.outerEdge && s.leg === (u.requestedLeg ?? "LEFT"));
                  return (
                    <li key={u.id} className="grid gap-3 py-4 lg:grid-cols-[1fr_2fr]">
                      <div className="text-sm">
                        <Link href={`/admin/users/${u.id}`} className="font-medium text-primary underline">{u.name}</Link>
                        <p className="text-muted-foreground">Sponsor: {u.sponsor ? `${u.sponsor.name} (${u.sponsor.referralCode})` : "company"}</p>
                        <p className="text-muted-foreground">Asked for: {u.requestedLeg?.toLowerCase() ?? "no preference"} · waiting since {formatDate(u.createdAt)}</p>
                      </div>
                      <form action={placeMemberAction.bind(null, u.id)} className="flex flex-wrap items-end gap-2">
                        <div className="min-w-64 flex-1 space-y-1">
                          <label htmlFor={`slot-${u.id}`} className="text-xs font-medium text-muted-foreground">Open position</label>
                          <Select id={`slot-${u.id}`} name="slot" required defaultValue={preferred ? `${preferred.parentId}:${preferred.leg}` : undefined}>
                            {slots.map((s) => (
                              <option key={`${s.parentId}:${s.leg}`} value={`${s.parentId}:${s.leg}`}>
                                {s.leg.toLowerCase()} of {nodeName.get(s.parentId) ?? s.parentId}{s.outerEdge ? " (outside edge)" : ""}
                              </option>
                            ))}
                          </Select>
                        </div>
                        <div className="w-full max-w-md"><ReasonFields idPrefix={`place-${u.id}`} confirm="PLACE" reasonLabel="Why this position (kept in the audit log; placement can't be undone)" /></div>
                        <Button disabled={slots.length === 0}>Place</Button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <MemberSearch q={sp.q} hits={hits} basePath="/admin/network" placeholder="Name, email or referral code" />
      <div className="flex gap-2">
        {root?.parentId && <Button asChild variant="outline" size="sm"><Link href={`?n=${root.parentId}`}>Up one level</Link></Button>}
        {root?.parentId && <Button asChild variant="ghost" size="sm"><Link href="?">Top</Link></Button>}
      </div>
      {sp.n && !root && <Alert tone="error">That position doesn't exist.</Alert>}
      {tree ? <BinaryTree root={tree} basePath="/admin/network" /> : !sp.n && <Alert>The network is empty.</Alert>}

      <Card>
        <CardHeader><CardTitle>Recent placements</CardTitle><CardDescription>Every placement is recorded permanently with who made it.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <THead><tr><Th>When</Th><Th>Member</Th><Th>Position</Th><Th>How</Th><Th>By</Th></tr></THead>
            <TBody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <Td>{formatDate(r.createdAt)}</Td>
                  <Td><Link className="text-primary underline" href={`/admin/users/${r.userId}`}>{personName.get(r.userId) ?? r.userId}</Link></Td>
                  <Td>{r.parentId ? `${r.position?.toLowerCase()} of ${nodeName.get(r.parentId) ?? "…"}` : "root"}</Td>
                  <Td>{methodLabel[r.method]}</Td>
                  <Td>{r.actorId ? personName.get(r.actorId) ?? r.actorId : "system"}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
