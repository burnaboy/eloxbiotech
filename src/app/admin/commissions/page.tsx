import { randomBytes } from "node:crypto";
import { ConfirmAction, ReasonFields } from "@/components/admin/high-risk";
import Link from "next/link";
import type { CommissionStatus, CommissionType, Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand, getCompPlan, getOps } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Stat } from "@/components/stat";
import { Empty, TBody, THead, Table, Td, Th } from "@/components/ui/table";
import { Flash } from "@/components/flash";
import { Pager } from "@/components/admin/pager";
import { adjustmentAction, holdCommissionAction, matureNowAction, runBinaryAction } from "../actions";

const STATUSES: CommissionStatus[] = ["PENDING", "HELD", "APPROVED", "REVERSED"];
const TYPES: CommissionType[] = ["DIRECT", "BINARY", "ADJUSTMENT"];
const PAGE = 50;

export default async function AdminCommissions({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; status?: string; type?: string; page?: string }> }) {
  await requireAdmin("COMMISSIONS");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.CommissionWhereInput = {
    ...(STATUSES.includes(sp.status as CommissionStatus) ? { status: sp.status as CommissionStatus } : {}),
    ...(TYPES.includes(sp.type as CommissionType) ? { type: sp.type as CommissionType } : {}),
  };
  const [brand, plan, ops, totals, runs, rows] = await Promise.all([
    getBrand(),
    getCompPlan(),
    getOps(),
    prisma.commission.groupBy({ by: ["status"], _sum: { amountMinor: true } }),
    prisma.binaryRun.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.commission.findMany({ where, include: { user: { select: { id: true, name: true } }, order: { select: { id: true, number: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE + 1 }),
  ]);
  const m = (v: number) => formatMoney(v, brand.currency);
  const t = (s: CommissionStatus) => totals.find((x) => x.status === s)?._sum.amountMinor ?? 0;
  const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(new Date(Date.now() - 864e5));
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Commissions</h1>
      <Flash sp={sp} />
      {ops.commissionsPaused && <Alert tone="error">Commission processing is paused under Emergency operations.</Alert>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {STATUSES.map((s) => <Stat key={s} label={s.toLowerCase()} value={m(t(s))} />)}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Approve matured orders</CardTitle><CardDescription>Runs hourly on its own. Approves commissions for orders past the {plan.holdDays}-day window and adds their volume to the tree.</CardDescription></CardHeader>
          <CardContent><form action={matureNowAction}><Button variant="outline">Run now</Button></form></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Binary run</CardTitle><CardDescription>Runs daily on its own. Each day can only be paid once. Needs a fresh authenticator code.</CardDescription></CardHeader>
          <CardContent>
            <form action={runBinaryAction} className="space-y-2">
              <Input type="date" name="period" defaultValue={yesterday} aria-label="Period" className="max-w-44" />
              <ReasonFields idPrefix="binary" confirm="RUN" />
              <Button>Run</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Manual adjustment</CardTitle><CardDescription>Positive or negative. Always explain why; members see the note.</CardDescription></CardHeader>
          <CardContent>
            <form action={adjustmentAction} className="space-y-2">
              <Input name="email" type="email" placeholder="Member email" aria-label="Member email" required />
              <Input name="amount" inputMode="decimal" placeholder="Amount, e.g. -1500" aria-label="Amount" required />
              <Input name="note" placeholder="Reason (kept permanently, shown to the member)" aria-label="Reason" required minLength={10} />
              <input type="hidden" name="formKey" value={randomBytes(18).toString("base64url")} />
              <Button variant="outline">Post correction</Button>
            </form>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Recent binary runs</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {runs.length === 0 ? <p className="text-muted-foreground">None yet.</p> : (
            <ul className="divide-y">{runs.map((r) => <li key={r.id} className="flex justify-between py-2"><span>{r.periodKey}</span><span>{r.pairsPaid} pairs · {m(r.amountMinor)} paid · {m(r.flushedMinor)} over cap</span></li>)}</ul>
          )}
        </CardContent>
      </Card>
      <form className="flex flex-wrap gap-2">
        <Select name="status" defaultValue={sp.status ?? ""} className="max-w-40" aria-label="Status"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</Select>
        <Select name="type" defaultValue={sp.type ?? ""} className="max-w-40" aria-label="Type"><option value="">All types</option>{TYPES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</Select>
        <Button variant="outline">Filter</Button>
      </form>
      {rows.length === 0 ? <Empty>No commissions.</Empty> : (
        <Table>
          <THead><tr><Th>Date</Th><Th>Member</Th><Th>Type</Th><Th>Source</Th><Th>Status</Th><Th className="text-right">Amount</Th><Th>Action</Th></tr></THead>
          <TBody>
            {rows.slice(0, PAGE).map((c) => (
              <tr key={c.id}>
                <Td>{formatDate(c.createdAt)}</Td>
                <Td><Link className="text-primary underline" href={`/admin/users/${c.user.id}`}>{c.user.name}</Link></Td>
                <Td><Badge>{c.type.toLowerCase()}</Badge></Td>
                <Td>{c.order ? <Link className="text-primary underline" href={`/admin/orders/${c.order.id}`}>{c.order.number}</Link> : c.note ?? "—"}</Td>
                <Td><StatusBadge status={c.status} />{c.holdReason && <span className="block text-xs text-muted-foreground">{c.holdReason}</span>}</Td>
                <Td className="text-right tabular-nums">{m(c.amountMinor)}</Td>
                <Td>
                  {["PENDING", "APPROVED"].includes(c.status) && c.amountMinor > 0 && c.paidMinor === 0 && (
                    <ConfirmAction id={`hold-${c.id}`} action={holdCommissionAction.bind(null, c.id, true)} label="Hold" size="sm" />
                  )}
                  {c.status === "HELD" && <ConfirmAction id={`release-${c.id}`} action={holdCommissionAction.bind(null, c.id, false)} label="Release" size="sm" />}
                </Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      <Pager page={page} hasMore={rows.length > PAGE} params={{ status: sp.status, type: sp.type }} />
    </>
  );
}
