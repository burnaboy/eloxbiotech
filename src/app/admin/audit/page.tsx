import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TBody, THead, Table, Td, Th } from "@/components/ui/table";
import { Pager } from "@/components/admin/pager";
import type { Prisma } from "@prisma/client";

const PRIVILEGED = ["admin.", "settings.compPlan", "ops.", "mfa.reset", "payout.paid", "order.refund", "commission.adjust", "binary.run"];
const PAGE = 100;

export default async function Audit({ searchParams }: { searchParams: Promise<{ q?: string; privileged?: string; page?: string }> }) {
  await requireAdmin("AUDIT");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.AuditLogWhereInput = {
    ...(sp.q ? { OR: [{ action: { contains: sp.q } }, { entityId: sp.q }, { actorId: sp.q }] } : {}),
    ...(sp.privileged ? { OR: PRIVILEGED.map((p) => ({ action: { startsWith: p } })) } : {}),
  };
  const logs = await prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE + 1 });
  const actorIds = [...new Set(logs.map((l) => l.actorId).filter(Boolean))] as string[];
  const actors = new Map((await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
      <p className="text-sm text-muted-foreground">Append-only record of sign-ups, orders, payments, refunds, commissions, payouts, setting changes and admin actions.</p>
      <form className="flex flex-wrap gap-2">
        <Input name="q" defaultValue={sp.q} placeholder="Action, or an id" className="max-w-xs" aria-label="Search" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="privileged" value="1" defaultChecked={!!sp.privileged} className="h-4 w-4" /> Privileged actions only</label>
        <Button variant="outline">Filter</Button>
      </form>
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
      <Pager page={page} hasMore={logs.length > PAGE} params={{ q: sp.q, privileged: sp.privileged }} />
    </>
  );
}
