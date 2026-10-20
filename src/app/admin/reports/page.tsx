import Link from "next/link";
import { canAccess, requireAdmin } from "@/lib/session";
import { getBrand } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { parseRange, searchText } from "@/lib/admin-filters";
import { attributionReport, payoutReconciliation, refundsInRange, revenueReport, salesOverview } from "@/lib/reports";
import { FilterBar } from "@/components/admin/filter-bar";
import { Stat } from "@/components/stat";
import { Alert } from "@/components/ui/alert";
import { Select } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, TBody, THead, Table, Td, Th } from "@/components/ui/table";

export const metadata = { title: "Reports" };

type SP = { tab?: string; from?: string; to?: string; group?: string; q?: string };
const TABS = [
  { id: "revenue", label: "Revenue", perm: "ORDERS" },
  { id: "attribution", label: "Referral attribution", perm: "COMMISSIONS" },
  { id: "payouts", label: "Payout reconciliation", perm: "PAYOUTS" },
] as const;

export default async function Reports({ searchParams }: { searchParams: Promise<SP> }) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const tabs = TABS.filter((t) => canAccess(admin, t.perm));
  if (tabs.length === 0) return <Alert tone="error">You don&apos;t have access to any reports.</Alert>;
  const tab = tabs.find((t) => t.id === sp.tab) ?? tabs[0];
  const range = parseRange(sp.from, sp.to, 30);
  const shown = { ...sp, from: range.from, to: range.to, tab: tab.id };
  const brand = await getBrand();
  const m = (v: number) => formatMoney(v, brand.currency);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
      <nav aria-label="Reports" className="flex flex-wrap gap-1 border-b">
        {tabs.map((t) => (
          <Link key={t.id} href={`?tab=${t.id}&from=${range.from ?? ""}&to=${range.to ?? ""}`} aria-current={t.id === tab.id ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${t.id === tab.id ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </Link>
        ))}
      </nav>
      <p className="text-sm text-muted-foreground">Dates are in Lagos time. Only orders whose payment was verified with the payment provider are counted.</p>
      {tab.id === "revenue" && <Revenue sp={shown} m={m} />}
      {tab.id === "attribution" && <Attribution sp={shown} m={m} />}
      {tab.id === "payouts" && <Payouts sp={shown} m={m} />}
    </>
  );
}

type Part = { sp: SP & { from?: string; to?: string }; m: (v: number) => string };

async function Revenue({ sp, m }: Part) {
  const range = parseRange(sp.from, sp.to);
  const group = sp.group === "month" ? "month" : "day";
  const [{ rows, totals }, overview, refunds] = await Promise.all([revenueReport(range, group), salesOverview(range), refundsInRange(range)]);
  return (
    <>
      <FilterBar sp={sp} exportReport="revenue">
        <input type="hidden" name="tab" value="revenue" />
        <div className="space-y-1">
          <label htmlFor="group" className="block text-xs font-medium text-muted-foreground">Group by</label>
          <Select id="group" name="group" defaultValue={group} className="w-32"><option value="day">Day</option><option value="month">Month</option></Select>
        </div>
      </FilterBar>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Paid orders" value={overview.paidOrders.toLocaleString()} hint={`${overview.pendingOrders} unpaid order(s) created in the period`} />
        <Stat label="Takings" value={m(totals.totalMinor)} hint={`Average order ${m(overview.averageMinor)}`} />
        <Stat label="Refunded on these orders" value={m(totals.refundedMinor)} hint={`${m(refunds.amountMinor)} in ${refunds.count} refund(s) confirmed in the period`} />
        <Stat label="Net takings" value={m(totals.netMinor)} hint={`Includes ${m(totals.taxMinor)} VAT and ${m(totals.shippingMinor)} delivery`} />
      </div>
      {rows.length === 0 ? <Empty>No paid orders in this period.</Empty> : (
        <Table>
          <caption className="sr-only">Revenue by {group}</caption>
          <THead><tr><Th>{group === "month" ? "Month" : "Day"}</Th><Th className="text-right">Orders</Th><Th className="text-right">Goods</Th><Th className="text-right">Discounts</Th><Th className="text-right">Delivery</Th><Th className="text-right">VAT</Th><Th className="text-right">Total</Th><Th className="text-right">Refunded</Th><Th className="text-right">Net</Th></tr></THead>
          <TBody>
            {rows.map((r) => (
              <tr key={r.period}>
                <Th scope="row" className="font-normal">{r.period}</Th>
                <Td className="text-right tabular-nums">{r.orders}</Td>
                <Td className="text-right tabular-nums">{m(r.goodsMinor)}</Td>
                <Td className="text-right tabular-nums">{r.discountMinor ? `−${m(r.discountMinor)}` : "—"}</Td>
                <Td className="text-right tabular-nums">{m(r.shippingMinor)}</Td>
                <Td className="text-right tabular-nums">{m(r.taxMinor)}</Td>
                <Td className="text-right tabular-nums">{m(r.totalMinor)}</Td>
                <Td className="text-right tabular-nums">{r.refundedMinor ? `−${m(r.refundedMinor)}` : "—"}</Td>
                <Td className="text-right font-medium tabular-nums">{m(r.netMinor)}</Td>
              </tr>
            ))}
            <tr className="bg-muted/40 font-medium">
              <Th scope="row">Total</Th>
              <Td className="text-right tabular-nums">{totals.orders}</Td>
              <Td className="text-right tabular-nums">{m(totals.goodsMinor)}</Td>
              <Td className="text-right tabular-nums">{totals.discountMinor ? `−${m(totals.discountMinor)}` : "—"}</Td>
              <Td className="text-right tabular-nums">{m(totals.shippingMinor)}</Td>
              <Td className="text-right tabular-nums">{m(totals.taxMinor)}</Td>
              <Td className="text-right tabular-nums">{m(totals.totalMinor)}</Td>
              <Td className="text-right tabular-nums">{totals.refundedMinor ? `−${m(totals.refundedMinor)}` : "—"}</Td>
              <Td className="text-right tabular-nums">{m(totals.netMinor)}</Td>
            </tr>
          </TBody>
        </Table>
      )}
    </>
  );
}

async function Attribution({ sp, m }: Part) {
  const range = parseRange(sp.from, sp.to);
  const { rows, unattributed } = await attributionReport(range, searchText(sp.q));
  const totalSales = rows.reduce((a, r) => a + r.goodsMinor, 0);
  const totalCommission = rows.reduce((a, r) => a + r.commissionMinor, 0);
  return (
    <>
      <FilterBar sp={sp} search={{ placeholder: "Affiliate name, email or code" }} exportReport="attribution">
        <input type="hidden" name="tab" value="attribution" />
      </FilterBar>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Retail sales through affiliates" value={m(totalSales)} hint={`${rows.reduce((a, r) => a + r.orders, 0)} customer order(s)`} />
        <Stat label="Direct commission on them" value={m(totalCommission)} hint={totalSales ? `${((totalCommission / totalSales) * 100).toFixed(1)}% of those sales` : undefined} />
        <Stat label="Sales with no referrer" value={m(unattributed.goodsMinor)} hint={`${unattributed.orders} order(s)`} />
      </div>
      {rows.length === 0 ? <Empty>No attributed sales in this period.</Empty> : (
        <Table>
          <caption className="sr-only">Sales by referring affiliate</caption>
          <THead><tr><Th>Affiliate</Th><Th className="text-right">Retail orders</Th><Th className="text-right">Retail sales</Th><Th className="text-right">Refunded</Th><Th className="text-right">Direct commission</Th><Th className="text-right">Purchases by their affiliates</Th></tr></THead>
          <TBody>
            {rows.map((r) => (
              <tr key={r.referrerId}>
                <Th scope="row" className="font-normal"><Link href={`/admin/users/${r.referrerId}`} className="font-medium text-primary hover:underline">{r.name}</Link><span className="block text-xs text-muted-foreground">{r.referralCode} · {r.email}</span></Th>
                <Td className="text-right tabular-nums">{r.orders}</Td>
                <Td className="text-right tabular-nums">{m(r.goodsMinor)}</Td>
                <Td className="text-right tabular-nums">{r.refundedMinor ? m(r.refundedMinor) : "—"}</Td>
                <Td className="text-right tabular-nums">{m(r.commissionMinor)}</Td>
                <Td className="text-right tabular-nums">{r.memberPurchases || "—"}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
      <p className="text-xs text-muted-foreground">Retail means orders by customers. Purchases by affiliates they sponsored are shown separately: they earn no direct commission unless the plan allows it, and a high count can mean buying to qualify rather than genuine customer sales.</p>
    </>
  );
}

async function Payouts({ sp, m }: Part) {
  const range = parseRange(sp.from, sp.to);
  const r = await payoutReconciliation(range);
  const match = r.settled.amountMinor === r.ledgerPaid.amountMinor && r.problems.length === 0;
  return (
    <>
      <FilterBar sp={sp} exportReport="payout-reconciliation">
        <input type="hidden" name="tab" value="payouts" />
      </FilterBar>
      <Alert tone={match ? "success" : "error"}>
        {match
          ? `Withdrawals and the wallet ledger agree for this period: ${m(r.settled.amountMinor)} paid in ${r.settled.count} transfer(s).`
          : `Mismatch: withdrawals marked paid total ${m(r.settled.amountMinor)}, ledger shows ${m(r.ledgerPaid.amountMinor)} paid out, and ${r.problems.length} withdrawal(s) need checking.`}
      </Alert>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Requested in the period, by status</CardTitle></CardHeader>
          <CardContent>
            {r.byStatus.length === 0 ? <Empty>No withdrawals requested.</Empty> : (
              <ul className="divide-y text-sm">
                {r.byStatus.map((s) => <li key={s.status} className="flex justify-between py-2"><span><StatusBadge status={s.status} /> <span className="ml-2 text-muted-foreground">{s.count}</span></span><span className="tabular-nums">{m(s.amountMinor)}</span></li>)}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Withdrawals needing a check</CardTitle><CardDescription>Where a withdrawal&apos;s status and its ledger entries disagree.</CardDescription></CardHeader>
          <CardContent>
            {r.problems.length === 0 ? <Empty>None.</Empty> : (
              <ul className="space-y-1 text-sm">{r.problems.map((p) => <li key={p.payoutId + p.issue}><code className="text-xs">{p.payoutId}</code> · {p.issue}</li>)}</ul>
            )}
          </CardContent>
        </Card>
      </div>
      {r.batches.length > 0 && (
        <Table>
          <caption className="sr-only">Payout batches</caption>
          <THead><tr><Th>Batch</Th><Th>Created</Th><Th>Status</Th><Th>Exported</Th><Th className="text-right">Withdrawals</Th><Th className="text-right">Paid</Th><Th className="text-right">Failed</Th><Th className="text-right">Still sending</Th><Th className="text-right">Total</Th></tr></THead>
          <TBody>
            {r.batches.map((b) => (
              <tr key={b.id}>
                <Th scope="row" className="font-normal">{b.number}</Th>
                <Td>{formatDate(b.createdAt)}</Td>
                <Td><StatusBadge status={b.status} /></Td>
                <Td>{b.exportedAt ? formatDate(b.exportedAt) : "—"}</Td>
                <Td className="text-right tabular-nums">{b.count}</Td>
                <Td className="text-right tabular-nums">{b.paid}</Td>
                <Td className="text-right tabular-nums">{b.failed}</Td>
                <Td className="text-right tabular-nums">{b.open}</Td>
                <Td className="text-right tabular-nums">{m(b.totalMinor)}</Td>
              </tr>
            ))}
          </TBody>
        </Table>
      )}
    </>
  );
}
