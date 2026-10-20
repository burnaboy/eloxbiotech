import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { pageOf, parseRange } from "@/lib/admin-filters";
import { BUCKETS, LEDGER_TYPES, ledgerWhere } from "@/lib/exports";
import { LEDGER_LABEL } from "@/lib/ledger";
import { FilterBar } from "@/components/admin/filter-bar";
import { Pager } from "@/components/admin/pager";
import { Input, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Empty, TBody, THead, Table, Td, Th } from "@/components/ui/table";

export const metadata = { title: "Commission ledger" };
const PAGE = 100;

type SP = { member?: string; type?: string; bucket?: string; ref?: string; from?: string; to?: string; page?: string };

export default async function LedgerSearch({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdmin("COMMISSIONS");
  const sp = await searchParams;
  const page = pageOf(sp.page);
  const range = parseRange(sp.from, sp.to);
  const params = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
  const where = await ledgerWhere(params, range);
  const [entries, brand, sum] = await Promise.all([
    prisma.ledgerEntry.findMany({ where, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE + 1 }),
    getBrand(),
    prisma.ledgerEntry.aggregate({ where, _sum: { amountMinor: true }, _count: true }),
  ]);
  const m = (v: number) => formatMoney(v, brand.currency);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Commission ledger</h1>
      <p className="text-sm text-muted-foreground">
        Every movement of members&apos; money, newest first. Entries are permanent: a mistake is fixed with a new correction entry, never by editing.
        Each entry moves a positive amount from one bucket to another (&quot;outside&quot; means money entering from a sale or leaving through a correction).
      </p>
      <FilterBar sp={sp} search={{ placeholder: "Member email, code or id", name: "member" }} exportReport="ledger">
        <div className="space-y-1">
          <label htmlFor="type" className="block text-xs font-medium text-muted-foreground">Entry type</label>
          <Select id="type" name="type" defaultValue={sp.type ?? ""} className="w-48">
            <option value="">All types</option>
            {LEDGER_TYPES.map((t) => <option key={t} value={t}>{LEDGER_LABEL[t] ?? t}</option>)}
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor="bucket" className="block text-xs font-medium text-muted-foreground">Bucket</label>
          <Select id="bucket" name="bucket" defaultValue={sp.bucket ?? ""} className="w-36">
            <option value="">Any</option>
            {BUCKETS.map((b) => <option key={b} value={b}>{b.replace("_", " ").toLowerCase()}</option>)}
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor="ref" className="block text-xs font-medium text-muted-foreground">Source, commission or payout id</label>
          <Input id="ref" name="ref" defaultValue={sp.ref} className="w-56" maxLength={100} />
        </div>
      </FilterBar>
      <p className="text-sm text-muted-foreground">{sum._count.toLocaleString()} matching entr{sum._count === 1 ? "y" : "ies"}, {m(sum._sum.amountMinor ?? 0)} moved in total.</p>
      {entries.length === 0 ? <Empty>No ledger entries match these filters.</Empty> : (
        <Table>
          <caption className="sr-only">Ledger entries</caption>
          <THead><tr><Th>When</Th><Th>Member</Th><Th>Type</Th><Th>From → to</Th><Th className="text-right">Amount</Th><Th>Source</Th></tr></THead>
          <TBody>
            {entries.slice(0, PAGE).map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap">{formatDate(e.createdAt)}</Td>
                <Td><Link href={`/admin/users/${e.user.id}`} className="text-primary hover:underline">{e.user.name}</Link><span className="block text-xs text-muted-foreground">{e.user.email}</span></Td>
                <Td><Badge>{LEDGER_LABEL[e.type] ?? e.type}</Badge>{e.memo && <span className="block max-w-xs text-xs text-muted-foreground">{e.memo}</span>}</Td>
                <Td className="whitespace-nowrap text-xs">{(e.fromBucket ?? "outside").toLowerCase()} → {(e.toBucket ?? "outside").toLowerCase()}</Td>
                <Td className="text-right tabular-nums">{m(e.amountMinor)}</Td>
                <Td className="text-xs">{e.sourceType} <code>{e.sourceId}</code><span className="block text-muted-foreground" title="Idempotency key">{e.idempotencyKey}</span></Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      <Pager page={page} hasMore={entries.length > PAGE} params={{ ...sp, page: undefined }} />
    </>
  );
}
