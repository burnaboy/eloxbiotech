import { requireAffiliate } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { formatBps, formatDate } from "@/lib/utils";
import { LEDGER_LABEL, availableEffect } from "@/lib/ledger";
import Link from "next/link";
import type { CommissionStatus } from "@prisma/client";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { walletBalance } from "@/lib/wallet";
import { Stat } from "@/components/stat";
import { Empty, TBody, THead, Table, Td, Th } from "@/components/ui/table";

export const metadata = { title: "Commissions" };

function describe(c: { type: string; details: unknown; note: string | null; baseMinor: number | null; rateBps: number | null; planVersion: { version: number } | null; order: { number: string; currency: string } | null }) {
  const d = (c.details ?? {}) as Record<string, number | string>;
  if (c.type === "DIRECT" && c.rateBps !== null && c.baseMinor !== null) {
    return `${formatBps(c.rateBps)} of ${formatMoney(c.baseMinor, c.order?.currency)} eligible sales on order ${c.order?.number ?? ""}${c.planVersion ? ` · plan v${c.planVersion.version}` : ""}`;
  }
  if (c.type === "DIRECT") return `Order ${c.order?.number ?? ""}`;
  if (c.type === "BINARY") return `${d.pairs} pair(s) for ${d.periodKey}${Number(d.flushedMinor) > 0 ? " (daily cap reached)" : ""}`;
  return c.note ?? "Adjustment";
}

const STATUSES: CommissionStatus[] = ["PENDING", "HELD", "APPROVED", "REVERSED"];

export default async function CommissionsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireAffiliate();
  const { status } = await searchParams;
  const filter = STATUSES.includes(status as CommissionStatus) ? (status as CommissionStatus) : undefined;
  const [rows, brand, wallet, entries] = await Promise.all([
    prisma.commission.findMany({ where: { userId: user.id, ...(filter ? { status: filter } : {}) }, include: { order: { select: { number: true, currency: true } }, planVersion: { select: { version: true } } }, orderBy: { createdAt: "desc" }, take: 300 }),
    getBrand(),
    walletBalance(user.id),
    prisma.ledgerEntry.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const mm = (v: number) => formatMoney(v, brand.currency);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Commission statement</h1>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Pending" value={mm(wallet.pendingMinor)} hint="Waiting for the return window" />
        <Stat label="Held" value={mm(wallet.heldMinor)} hint="Disputed or under review" />
        <Stat label="Available" value={mm(wallet.availableMinor)} hint="Approved, not yet withdrawn" />
        <Stat label="Withdrawn" value={mm(wallet.paidOutMinor)} hint={wallet.reservedMinor ? `${mm(wallet.reservedMinor)} more on its way` : "Paid to your bank"} />
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
                <Td className={`text-right tabular-nums ${c.amountMinor < 0 ? "text-destructive" : ""}`}>
                  {formatMoney(c.amountMinor - c.reversedMinor, brand.currency)}
                  {c.reversedMinor > 0 && c.status !== "REVERSED" && <span className="block text-xs text-muted-foreground line-through">{formatMoney(c.amountMinor, brand.currency)}</span>}
                  {c.status === "REVERSED" && <span className="block text-xs text-muted-foreground">was {formatMoney(c.amountMinor, brand.currency)}</span>}
                </Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      <h2 className="text-lg font-semibold">Wallet activity</h2>
      <p className="text-sm text-muted-foreground">Every change to your balances, newest first. Entries are permanent; corrections appear as new entries.</p>
      {entries.length === 0 ? <Empty>No wallet activity yet.</Empty> : (
        <Table>
          <THead><tr><Th>Date</Th><Th>What happened</Th><Th>Note</Th><Th className="text-right">Effect on available</Th></tr></THead>
          <TBody>
            {entries.map((e) => {
              const eff = availableEffect(e);
              return (
                <tr key={e.id}>
                  <Td>{formatDate(e.createdAt)}</Td>
                  <Td>{LEDGER_LABEL[e.type]} <span className="text-muted-foreground">({formatMoney(e.amountMinor, brand.currency)}{e.fromBucket ? ` from ${e.fromBucket.toLowerCase().replace("_", " ")}` : ""}{e.toBucket ? ` to ${e.toBucket.toLowerCase().replace("_", " ")}` : ""})</span></Td>
                  <Td className="text-muted-foreground">{e.memo ?? ""}</Td>
                  <Td className={`text-right tabular-nums ${eff < 0 ? "text-destructive" : eff > 0 ? "text-success" : "text-muted-foreground"}`}>{eff === 0 ? "—" : `${eff > 0 ? "+" : "−"}${formatMoney(Math.abs(eff), brand.currency)}`}</Td>
                </tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </>
  );
}
