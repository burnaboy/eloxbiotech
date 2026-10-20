import { requireAffiliate } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import type { CommissionStatus } from "@prisma/client";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { walletBalance } from "@/lib/wallet";
import { Stat } from "@/components/stat";
import { Empty, TBody, THead, Table, Td, Th } from "@/components/ui/table";

export const metadata = { title: "Commissions" };

function describe(c: { type: string; details: unknown; note: string | null; order: { number: string } | null }) {
  const d = (c.details ?? {}) as Record<string, number | string>;
  if (c.type === "DIRECT") return `${d.percent}% of order ${c.order?.number ?? ""}`;
  if (c.type === "BINARY") return `${d.pairs} pair(s) for ${d.periodKey}${Number(d.flushedMinor) > 0 ? " (daily cap reached)" : ""}`;
  return c.note ?? "Adjustment";
}

const STATUSES: CommissionStatus[] = ["PENDING", "HELD", "APPROVED", "REVERSED", "PAID"];

export default async function CommissionsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireAffiliate();
  const { status } = await searchParams;
  const filter = STATUSES.includes(status as CommissionStatus) ? (status as CommissionStatus) : undefined;
  const [rows, brand, wallet] = await Promise.all([
    prisma.commission.findMany({ where: { userId: user.id, ...(filter ? { status: filter } : {}) }, include: { order: { select: { number: true } } }, orderBy: { createdAt: "desc" }, take: 300 }),
    getBrand(),
    walletBalance(user.id),
  ]);
  const mm = (v: number) => formatMoney(v, brand.currency);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Commission statement</h1>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Pending" value={mm(wallet.pendingMinor)} hint="Waiting for the return window" />
        <Stat label="Held" value={mm(wallet.heldMinor)} hint="Disputed or under review" />
        <Stat label="Available" value={mm(wallet.availableMinor)} hint="Approved, not yet withdrawn" />
        <Stat label="Withdrawn" value={mm(wallet.withdrawnMinor)} hint="Requested or paid out" />
      </div>
      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {[undefined, ...STATUSES].map((s) => (
          <Link key={s ?? "all"} href={s ? `?status=${s}` : "?"} aria-current={filter === s ? "page" : undefined} className={`rounded-full border px-3 py-1 text-sm ${filter === s ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>{s ? s.toLowerCase() : "all"}</Link>
        ))}
      </nav>
      {rows.length === 0 ? <Empty>No commissions yet.</Empty> : (
        <Table>
          <THead><tr><Th>Date</Th><Th>Type</Th><Th>Status</Th><Th>Details</Th><Th className="text-right">Amount</Th></tr></THead>
          <TBody>
            {rows.map((c) => (
              <tr key={c.id}>
                <Td>{formatDate(c.createdAt)}</Td>
                <Td><Badge tone={c.amountMinor < 0 ? "danger" : "primary"}>{c.type.toLowerCase()}</Badge></Td>
                <Td><StatusBadge status={c.status} />{c.holdReason && <span className="block text-xs text-muted-foreground">{c.holdReason}</span>}</Td>
                <Td className="text-muted-foreground">{describe(c)}{c.status === "PENDING" && c.releaseAt ? ` · approves ${formatDate(c.releaseAt)}` : ""}</Td>
                <Td className={`text-right tabular-nums ${c.amountMinor < 0 ? "text-destructive" : ""}`}>{formatMoney(c.amountMinor, brand.currency)}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
