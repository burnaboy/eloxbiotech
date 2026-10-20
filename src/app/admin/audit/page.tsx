import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TBody, THead, Table, Td, Th } from "@/components/ui/table";
import { Pager } from "@/components/admin/pager";
import { FilterBar } from "@/components/admin/filter-bar";
import { dateWhere, pageOf, parseRange, searchText } from "@/lib/admin-filters";
import type { Prisma } from "@prisma/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Flash } from "@/components/flash";
import { verifyAuditAction } from "../actions";

const PRIVILEGED = ["admin.", "export.", "settings.finance", "settings.compPlan", "ops.", "mfa.reset", "payout.", "payoutBatch.", "payoutAccount.reveal", "order.refund", "commission.", "wallet.correction", "binary.run", "refund."];
const PAGE = 100;

export default async function Audit({ searchParams }: { searchParams: Promise<{ q?: string; privileged?: string; page?: string; ok?: string; error?: string; from?: string; to?: string }> }) {
  await requireAdmin("AUDIT");
  const sp = await searchParams;
  const page = pageOf(sp.page);
  const q = searchText(sp.q);
  const created = dateWhere(parseRange(sp.from, sp.to));
  const where: Prisma.AuditLogWhereInput = {
    AND: [
      ...(q ? [{ OR: [{ action: { contains: q } }, { entityId: q }, { actorId: q }] }] : []),
      ...(sp.privileged ? [{ OR: PRIVILEGED.map((p) => ({ action: { startsWith: p } })) }] : []),
      ...(created ? [{ createdAt: created }] : []),
    ],
  };
  const [lastVerify, head] = await Promise.all([
    prisma.auditLog.findFirst({ where: { action: "audit.verify" }, orderBy: { seq: "desc" } }),
    prisma.auditLog.findFirst({ where: { chainPos: { not: null } }, orderBy: { chainPos: "desc" }, select: { chainPos: true, hash: true, createdAt: true } }),
  ]);
  const v = lastVerify?.data as { ok?: boolean; checked?: number; brokenAt?: { chainPos: number } | null } | null;
  const logs = await prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE + 1 });
  const actorIds = [...new Set(logs.map((l) => l.actorId).filter(Boolean))] as string[];
  const actors = new Map((await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
      <p className="text-sm text-muted-foreground">Append-only record of sign-ups, orders, payments, refunds, commissions, payouts, setting changes and admin actions. Records can&apos;t be edited or deleted.</p>
      <Flash sp={sp} />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Tamper check {v ? <Badge tone={v.ok ? "success" : "danger"}>{v.ok ? "intact" : `broken at record ${v.brokenAt?.chainPos}`}</Badge> : <Badge>not run yet</Badge>}
          </CardTitle>
          <CardDescription>
            Each record is linked to the one before it by a hash, so changing or removing an old record breaks the chain from that point.
            {lastVerify ? ` Last checked ${formatDate(lastVerify.createdAt)} (${v?.checked ?? 0} records).` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {head && <p>Latest sealed record: #{head.chainPos} · <code className="break-all text-xs">{head.hash}</code></p>}
          <p className="text-muted-foreground">To also detect the whole chain being rewritten, note this hash somewhere outside the system from time to time (for example in the monthly finance pack).</p>
          <form action={verifyAuditAction}><Button size="sm" variant="outline">Verify now</Button></form>
        </CardContent>
      </Card>
      <FilterBar sp={sp} search={{ placeholder: "Action, or an id" }} exportReport="audit">
        <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" name="privileged" value="1" defaultChecked={!!sp.privileged} className="h-4 w-4" /> Privileged actions only</label>
      </FilterBar>
      <Table>
        <THead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Target</Th><Th>Details</Th></tr></THead>
        <TBody>
          {logs.slice(0, PAGE).map((l) => (
            <tr key={l.id}>
              <Td className="whitespace-nowrap">{formatDate(l.createdAt)}</Td>
              <Td>{l.actorId ? actors.get(l.actorId) ?? l.actorId : "system"}</Td>
              <Td><code>{l.action}</code></Td>
              <Td className="text-xs">{l.entity} {l.entityId}</Td>
              <Td><details><summary className="cursor-pointer text-xs text-primary">view</summary><pre className="max-w-md overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(l.data, null, 2)}</pre></details></Td>
            </tr>
          ))}
        </TBody>
      </Table>
      <Pager page={page} hasMore={logs.length > PAGE} params={{ q: sp.q, privileged: sp.privileged, from: sp.from, to: sp.to }} />
    </>
  );
}
