import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Flash } from "@/components/flash";
import { paymentIssues, reconcilePendingPayments } from "@/lib/payments/service";
import { sharedAccounts } from "@/lib/payouts/accounts";
import { redirect } from "next/navigation";
import type { AuditLog } from "@prisma/client";
import type { ReconcileIssue } from "@/lib/volume";
import { reconcileLedgerAction, reconcileVolumeAction } from "../actions";

function LedgerCheck({ last }: { last: AuditLog | null }) {
  const d = last?.data as { nodes?: number; orders?: number; issueCount?: number; issues?: ReconcileIssue[] } | null;
  const count = d?.issueCount ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Network ledger check {last ? <Badge tone={count ? "danger" : "success"}>{count ? `${count} mismatch(es)` : "all match"}</Badge> : <Badge>not run yet</Badge>}
        </CardTitle>
        <CardDescription>
          Recomputes every position's volume, carry and member counts from the order and volume ledgers, and checks refunded orders have no live commissions.
          It reports only and never changes balances. Runs daily; {last ? `last run ${formatDate(last.createdAt)} over ${d?.nodes ?? 0} positions and ${d?.orders ?? 0} orders.` : "it hasn't run yet."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <form action={reconcileVolumeAction}><Button size="sm" variant="outline">Check network volume</Button></form>
        {count > 0 && (
          <ul className="space-y-1">
            {d?.issues?.map((i, k) => <li key={k}><Badge tone="warning">{i.kind}</Badge> <span className="font-medium">{i.ref}</span> · {i.detail}</li>)}
            {count > (d?.issues?.length ?? 0) && <li className="text-muted-foreground">…and {count - (d?.issues?.length ?? 0)} more.</li>}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function WalletCheck({ last }: { last: AuditLog | null }) {
  const d = last?.data as { ok?: boolean; problemCount?: number; members?: number; commissions?: number; problems?: { kind: string; userId?: string; ref?: string; detail: string }[] } | null;
  const count = d?.problemCount ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Wallet ledger check {last ? <Badge tone={count ? "danger" : "success"}>{count ? `${count} problem(s)` : "all match"}</Badge> : <Badge>not run yet</Badge>}
        </CardTitle>
        <CardDescription>
          Checks every commission&apos;s money is in the right wallet bucket for its status and amount after reversals, and every member&apos;s reserved and paid-out balances equal their open and paid withdrawals.
          Reports only. Runs daily; {last ? `last run ${formatDate(last.createdAt)} over ${d?.members ?? 0} wallets and ${d?.commissions ?? 0} commissions.` : "it hasn't run yet."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <form action={reconcileLedgerAction}><Button size="sm" variant="outline">Check wallets</Button></form>
        {count > 0 && (
          <ul className="space-y-1">
            {d?.problems?.map((p, k) => <li key={k}><Badge tone="warning">{p.kind}</Badge> {p.userId && <Link className="text-primary underline" href={`/admin/users/${p.userId}`}>member</Link>} · {p.detail}</li>)}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

async function reconcileNow() {
  "use server";
  await requireAdmin("RISK");
  const r = await reconcilePendingPayments(0);
  redirect(`/admin/risk?ok=${encodeURIComponent(`Checked with the gateway: ${JSON.stringify(r)}`)}`);
}

function Section({ title, desc, children, count }: { title: string; desc: string; children: React.ReactNode; count: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">{title} <Badge tone={count ? "warning" : "success"}>{count}</Badge></CardTitle>
        <CardDescription>{desc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 text-sm">{count === 0 ? <p className="text-muted-foreground">Nothing to review.</p> : children}</CardContent>
    </Card>
  );
}

export default async function Risk({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireAdmin("RISK");
  const brand = await getBrand();
  const m = (v: number) => formatMoney(v, brand.currency);
  const hourAgo = new Date(Date.now() - 3600e3);
  const [lastCheck, lastWalletCheck, issues, banks, stalePayments, disputes, sharedIps, bigPayouts, selfBuys, failedLogins] = await Promise.all([
    prisma.auditLog.findFirst({ where: { action: "volume.reconcile" }, orderBy: { createdAt: "desc" } }),
    prisma.auditLog.findFirst({ where: { action: "ledger.reconcile" }, orderBy: { createdAt: "desc" } }),
    paymentIssues(),
    sharedAccounts(),
    prisma.payment.findMany({ where: { status: "PENDING", createdAt: { lt: hourAgo }, order: { status: "PENDING_PAYMENT" } }, include: { order: true }, take: 50 }),
    prisma.order.findMany({ where: { disputedAt: { not: null } }, take: 50 }),
    prisma.$queryRaw<{ ip: string; n: bigint }[]>`SELECT "signupIp" AS ip, COUNT(*)::bigint AS n FROM "User" WHERE "signupIp" IS NOT NULL AND "signupIp" <> 'unknown' GROUP BY "signupIp" HAVING COUNT(*) >= 3 ORDER BY n DESC LIMIT 20`,
    prisma.payout.findMany({ where: { status: { in: ["REQUESTED", "APPROVED", "PROCESSING"] } }, include: { user: true }, orderBy: { amountMinor: "desc" }, take: 5 }),
    // Affiliates whose earnings come mostly from their own customers' orders shipped to their own phone number.
    prisma.$queryRaw<{ id: string; number: string; name: string }[]>`
      SELECT o.id, o.number, r.name FROM "Order" o JOIN "User" r ON r.id = o."referrerId"
      WHERE o.status IN ('PAID','PROCESSING','SHIPPED','DELIVERED','PARTIALLY_REFUNDED') AND r.phone IS NOT NULL AND o."shipPhone" = r.phone
      ORDER BY o."createdAt" DESC LIMIT 20`,
    prisma.loginAttempt.groupBy({ by: ["key"], where: { success: false, createdAt: { gte: new Date(Date.now() - 864e5) } }, _count: true, having: { key: { _count: { gte: 10 } } } }),
  ]);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Risk & reconciliation</h1>
      <Flash sp={await searchParams} />
      <LedgerCheck last={lastCheck} />
      <WalletCheck last={lastWalletCheck} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Extra payments to give back" desc="A second payment on a paid order, or a payment that arrived after the order was cancelled. Return it from the order page." count={issues.extra.length}>
          {issues.extra.map((p) => <p key={p.id}><Link className="text-primary underline" href={`/admin/orders/${p.orderId}`}>{p.number}</Link> · {formatMoney(p.amountMinor, p.currency)} · order {p.status.toLowerCase().replace("_", " ")}</p>)}
        </Section>
        <Section title="Payments that didn't match the order" desc="Not accepted. Check the gateway and refund any money taken." count={issues.mismatched.length}>
          {issues.mismatched.map((p) => <p key={p.id}><Link className="text-primary underline" href={`/admin/orders/${p.orderId}`}>{p.order.number}</Link> · {p.failureReason}</p>)}
        </Section>
        <Section title="Refunds the gateway refused" desc="The order is already marked refunded but the customer hasn't got the money. Retry from the order page." count={issues.failedRefunds.length}>
          {issues.failedRefunds.map((r) => <p key={r.id}><Link className="text-primary underline" href={`/admin/orders/${r.orderId}`}>{r.order.number}</Link> · {formatMoney(r.amountMinor, r.order.currency)} · {r.failureReason}</p>)}
        </Section>
        <Section title="Refunds not confirmed after a day" desc="Check these in the payment gateway dashboard." count={issues.unconfirmedRefunds.length}>
          {issues.unconfirmedRefunds.map((r) => <p key={r.id}><Link className="text-primary underline" href={`/admin/orders/${r.orderId}`}>{r.order.number}</Link> · {formatMoney(r.amountMinor, r.order.currency)} · {formatDate(r.createdAt)}</p>)}
        </Section>
        <Section title="Bank accounts shared by several members" desc="One account receiving withdrawals for more than one member can mean duplicate or fake accounts." count={banks.length}>
          {banks.map((b) => <p key={b.fingerprint}>{b.bankName} •••• {b.last4} · {b.members} members</p>)}
        </Section>
        <Section title="Unconfirmed payments over an hour old" desc="The reconciliation job re-checks these with Paystack every 10 minutes." count={stalePayments.length}>
          <form action={reconcileNow} className="mb-2"><Button size="sm" variant="outline">Re-check with gateway now</Button></form>
          {stalePayments.map((p) => <p key={p.id}><Link className="text-primary underline" href={`/admin/orders/${p.orderId}`}>{p.order.number}</Link> · {p.provider} · {p.providerRef} · {m(p.amountMinor)}</p>)}
        </Section>
        <Section title="Open chargebacks" desc="Commissions on these orders are held until the dispute is resolved." count={disputes.length}>
          {disputes.map((o) => <p key={o.id}><Link className="text-primary underline" href={`/admin/orders/${o.id}`}>{o.number}</Link> since {formatDate(o.disputedAt)}</p>)}
        </Section>
        <Section title="Many accounts from one sign-up IP" desc="Can indicate fake accounts used to fill a tree. Shared office or mobile networks also cause this." count={sharedIps.length}>
          {sharedIps.map((s) => <p key={s.ip}><Link className="text-primary underline" href={`/admin/users?q=`}>{s.ip}</Link> · {Number(s.n)} accounts</p>)}
        </Section>
        <Section title="Orders shipped to the referrer's own phone" desc="Possible self-purchasing through a customer account to earn direct commission." count={selfBuys.length}>
          {selfBuys.map((o) => <p key={o.id}><Link className="text-primary underline" href={`/admin/orders/${o.id}`}>{o.number}</Link> · referrer {o.name}</p>)}
        </Section>
        <Section title="Repeated failed sign-ins (24h)" desc="Possible password guessing. Accounts lock for 15 minutes after 5 failures." count={failedLogins.length}>
          {failedLogins.map((f) => <p key={f.key}>{f.key} · {f._count} failures</p>)}
        </Section>
        <Section title="Largest open payout requests" desc="Check these against the member's sales before paying." count={bigPayouts.length}>
          {bigPayouts.map((p) => <p key={p.id}><Link className="text-primary underline" href={`/admin/users/${p.userId}`}>{p.user.name}</Link> · {m(p.amountMinor)}</p>)}
        </Section>
      </div>
    </>
  );
}
