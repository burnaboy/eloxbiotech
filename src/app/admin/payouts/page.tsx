import Link from "next/link";
import { ConfirmAction } from "@/components/admin/high-risk";
import { requireAdmin, canAccess } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand, getOps } from "@/lib/settings";
import { walletBalance } from "@/lib/wallet";
import { nameMatches } from "@/lib/payouts/accounts";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { dateToLagosLocal } from "@/lib/product-input";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/table";
import { Flash } from "@/components/flash";
import { createBatchAction, failPayoutAction, requeuePayoutAction, reviewPayoutAction, settlePayoutAction } from "../actions";

const TABS = [
  { key: "review", label: "To review" },
  { key: "ready", label: "Approved, ready to send" },
  { key: "sending", label: "Being sent" },
  { key: "history", label: "History" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default async function AdminPayouts({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; tab?: string }> }) {
  const admin = await requireAdmin("PAYOUTS");
  const sp = await searchParams;
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "review";
  const canExport = canAccess(admin, "PAYOUT_DETAILS");
  const statusFor: Record<Tab, ("REQUESTED" | "APPROVED" | "PROCESSING" | "PAID" | "REJECTED" | "FAILED")[]> = {
    review: ["REQUESTED"], ready: ["APPROVED"], sending: ["PROCESSING"], history: ["PAID", "REJECTED", "FAILED"],
  };
  const [brand, ops, list, counts] = await Promise.all([
    getBrand(),
    getOps(),
    prisma.payout.findMany({
      where: { status: { in: statusFor[tab] } },
      include: { user: { select: { id: true, name: true, email: true, createdAt: true } }, payoutAccount: true, batch: true },
      orderBy: { createdAt: tab === "history" ? "desc" : "asc" },
      take: 200,
    }),
    prisma.payout.groupBy({ by: ["status"], _count: true }),
  ]);
  const shared = new Set(
    (await prisma.payoutAccount.groupBy({ by: ["fingerprint"], where: { fingerprint: { in: list.flatMap((p) => (p.payoutAccount ? [p.payoutAccount.fingerprint] : [])) } }, _count: { userId: true } }))
      .filter((g) => g._count.userId > 1)
      .map((g) => g.fingerprint),
  );
  const balances = tab === "review" ? await Promise.all(list.map((p) => walletBalance(p.userId))) : [];
  const m = (v: number) => formatMoney(v, brand.currency);
  const count = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const badge: Record<Tab, number> = { review: count("REQUESTED"), ready: count("APPROVED"), sending: count("PROCESSING"), history: 0 };
  const batches = tab === "sending" ? [...new Map(list.filter((p) => p.batch).map((p) => [p.batch!.id, p.batch!])).values()] : [];
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Withdrawals</h1>
      <Flash sp={sp} />
      {ops.payoutsPaused && <Alert tone="error">Payouts are paused under Emergency operations. Reviews can continue; nothing can be sent.</Alert>}
      <nav aria-label="Withdrawal stages" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Link key={t.key} href={`?tab=${t.key}`} aria-current={tab === t.key ? "page" : undefined} className={`rounded-full border px-3 py-1 text-sm ${tab === t.key ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}>
            {t.label}{badge[t.key] ? ` (${badge[t.key]})` : ""}
          </Link>
        ))}
      </nav>
      <p className="text-sm text-muted-foreground">
        Every step needs a fresh authenticator code, and nobody can act on their own withdrawal. A withdrawal is only recorded as paid with the bank&apos;s transfer reference and a description of the settlement evidence you checked.
      </p>

      {list.length === 0 && <Empty>Nothing here right now.</Empty>}

      {tab === "review" && list.map((p, i) => {
        const a = p.payoutAccount;
        return (
          <Card key={p.id} className="space-y-3 p-5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p><Link href={`/admin/users/${p.userId}`} className="font-medium text-primary underline">{p.user.name}</Link> · {p.user.email} · member since {formatDate(p.user.createdAt)}</p>
              <strong className="tabular-nums">{m(p.amountMinor)}</strong>
            </div>
            <p>To <span className="font-mono">{p.destination}</span></p>
            <div className="flex flex-wrap gap-2">
              {a?.verifiedAt ? <Badge tone="success">account name confirmed by {a.verifiedBy}</Badge> : <Badge tone="warning">account not verified automatically</Badge>}
              {a && !nameMatches(a.accountName, p.user.name) && <Badge tone="danger">account name differs from member name</Badge>}
              {a && shared.has(a.fingerprint) && <Badge tone="danger">bank account also used by another member</Badge>}
              {a?.status === "REMOVED" && <Badge tone="danger">member removed this account</Badge>}
            </div>
            <p className="text-muted-foreground">Requested {formatDate(p.createdAt)} · available after this request: {m(balances[i].availableMinor)} · pending {m(balances[i].pendingMinor)} · held {m(balances[i].heldMinor)}</p>
            {p.userId === admin.id ? <p className="text-muted-foreground">Another administrator must review your own withdrawal.</p> : (
              <div className="flex flex-wrap items-start gap-4">
                <form action={reviewPayoutAction.bind(null, p.id, "APPROVE")} className="space-y-2">
                  {!a?.verifiedAt && <label className="flex items-center gap-2"><input type="checkbox" name="accountChecked" className="h-4 w-4" /> I have checked the account name with the bank</label>}
                  <Button variant="outline">Approve</Button>
                </form>
                <form action={reviewPayoutAction.bind(null, p.id, "REJECT")} className="flex gap-2">
                  <Input name="note" placeholder="Reason shown to member" aria-label="Rejection reason" className="w-56" required />
                  <Button variant="ghost" className="text-destructive">Reject</Button>
                </form>
              </div>
            )}
          </Card>
        );
      })}

      {tab === "ready" && list.length > 0 && (
        <form action={createBatchAction} className="space-y-3">
          <Card className="divide-y text-sm">
            {list.map((p) => (
              <label key={p.id} className="flex items-center gap-3 p-3">
                <input type="checkbox" name="payoutId" value={p.id} defaultChecked={p.userId !== admin.id} disabled={p.userId === admin.id} className="h-4 w-4" />
                <span className="flex-1">{p.user.name} · <span className="font-mono">{p.destination}</span>{p.attempt > 1 ? ` · attempt ${p.attempt}` : ""}</span>
                <strong className="tabular-nums">{m(p.amountMinor)}</strong>
              </label>
            ))}
          </Card>
          <Button disabled={ops.payoutsPaused}>Create payout batch</Button>
          <p className="text-xs text-muted-foreground">Creating a batch marks these withdrawals as being sent. Then download the transfer file{canExport ? "" : " (needs the payout-details permission)"} and make the transfers from the bank.</p>
        </form>
      )}

      {tab === "sending" && batches.map((b) => (
        <Card key={b.id} className="space-y-3 p-5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">Batch {b.number} · {b.count} withdrawal(s) · {m(b.totalMinor)}</p>
            <span className="flex items-center gap-2">
              <StatusBadge status={b.status} />
              {canExport && <Button asChild variant="outline" size="sm"><a href={`/admin/payouts/batches/${b.id}/export`}>Download transfer file</a></Button>}
            </span>
          </div>
          {b.exportedAt && <p className="text-muted-foreground">Transfer file downloaded {formatDate(b.exportedAt)}</p>}
          {list.filter((p) => p.batchId === b.id).map((p) => (
            <div key={p.id} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap justify-between gap-2"><span>{p.user.name} · <span className="font-mono">{p.destination}</span></span><strong className="tabular-nums">{m(p.amountMinor)}</strong></div>
              {p.userId === admin.id ? <p className="text-muted-foreground">Another administrator must confirm your own withdrawal.</p> : (
                <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
                  <form action={settlePayoutAction.bind(null, p.id)} className="grid gap-2 sm:grid-cols-2">
                    <Input name="reference" placeholder="Bank transfer reference" aria-label="Transfer reference" required />
                    <Input name="settledAt" type="datetime-local" aria-label="Date the transfer settled" defaultValue={dateToLagosLocal(new Date())} required />
                    <Input name="evidence" className="sm:col-span-2" placeholder="Evidence checked, e.g. 'GTBank statement 21 Oct, line 14, debit ₦50,000'" aria-label="Settlement evidence" required minLength={10} />
                    <div><Button>Record as paid</Button></div>
                  </form>
                  <form action={failPayoutAction.bind(null, p.id)} className="space-y-2">
                    <Input name="reason" placeholder="Why it failed (shown to member)" aria-label="Failure reason" required />
                    <Button variant="ghost" className="text-destructive">Mark failed</Button>
                  </form>
                </div>
              )}
            </div>
          ))}
        </Card>
      ))}

      {tab === "history" && list.map((p) => (
        <Card key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
          <div>
            <p><Link href={`/admin/users/${p.userId}`} className="text-primary underline">{p.user.name}</Link> · <span className="font-mono">{p.destination}</span></p>
            <p className="text-muted-foreground">
              Requested {formatDate(p.createdAt)}
              {p.status === "PAID" && ` · paid ${formatDate(p.settledAt)} · ref ${p.reference} · evidence: ${p.settlementEvidence}`}
              {p.failureReason && ` · ${p.failureReason}`}
              {p.batch && ` · batch ${p.batch.number}`}
            </p>
          </div>
          <span className="flex items-center gap-2">
            <StatusBadge status={p.status} /><strong className="tabular-nums">{m(p.amountMinor)}</strong>
            {p.status === "FAILED" && p.userId !== admin.id && <ConfirmAction id={`requeue-${p.id}`} action={requeuePayoutAction.bind(null, p.id)} label="Send again" size="sm" description="Confirm with the bank that the first transfer didn't arrive before sending again." />}
          </span>
        </Card>
      ))}
    </>
  );
}
