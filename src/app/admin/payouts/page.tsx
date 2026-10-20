import Link from "next/link";
import type { PayoutStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBrand, getOps } from "@/lib/settings";
import { walletBalance } from "@/lib/wallet";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/table";
import { Flash } from "@/components/flash";
import { payoutDecisionAction } from "../actions";

export default async function AdminPayouts({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; status?: string }> }) {
  const admin = await requireAdmin("PAYOUTS");
  const sp = await searchParams;
  const status = (["REQUESTED", "APPROVED", "PAID", "REJECTED"] as PayoutStatus[]).includes(sp.status as PayoutStatus) ? (sp.status as PayoutStatus) : undefined;
  const [brand, ops, list] = await Promise.all([
    getBrand(),
    getOps(),
    prisma.payout.findMany({ where: status ? { status } : { status: { in: ["REQUESTED", "APPROVED"] } }, include: { user: true }, orderBy: { createdAt: "asc" }, take: 200 }),
  ]);
  const balances = await Promise.all(list.map((p) => walletBalance(p.userId)));
  const m = (v: number) => formatMoney(v, brand.currency);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Payouts</h1>
      <Flash sp={sp} />
      {ops.payoutsPaused && <Alert tone="error">Payouts are paused under Emergency operations.</Alert>}
      <form className="flex gap-2">
        <Select name="status" defaultValue={sp.status ?? ""} className="max-w-48" aria-label="Status">
          <option value="">Open (requested + approved)</option><option value="REQUESTED">Requested</option><option value="APPROVED">Approved</option><option value="PAID">Paid</option><option value="REJECTED">Rejected</option>
        </Select>
        <Button variant="outline">Filter</Button>
      </form>
      <p className="text-sm text-muted-foreground">Send the money from your bank first, then mark it paid with the transfer reference. Marking paid needs a fresh authenticator code. You can't process your own payout.</p>
      {list.length === 0 ? <Empty>No payouts.</Empty> : list.map((p, i) => (
        <Card key={p.id} className="space-y-3 p-5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p><Link href={`/admin/users/${p.userId}`} className="font-medium text-primary underline">{p.user.name}</Link> · {p.user.email}</p>
            <span className="flex items-center gap-2"><StatusBadge status={p.status} /><strong className="tabular-nums">{m(p.amountMinor)}</strong></span>
          </div>
          <p>{p.method.replace("_", " ").toLowerCase()}: <span className="font-mono">{p.destination}</span></p>
          <p className="text-muted-foreground">Requested {formatDate(p.createdAt)} · member's balance after requests: {m(balances[i].availableMinor)} {p.reference && `· ref ${p.reference}`}</p>
          {p.userId !== admin.id && (
            <div className="flex flex-wrap gap-2">
              {p.status === "REQUESTED" && <form action={payoutDecisionAction.bind(null, p.id, "APPROVE")}><Button variant="outline">Approve</Button></form>}
              {p.status === "APPROVED" && (
                <form action={payoutDecisionAction.bind(null, p.id, "PAY")} className="flex gap-2">
                  <Input name="reference" placeholder="Bank transfer reference" aria-label="Transfer reference" required className="w-60" />
                  <Button>Mark paid</Button>
                </form>
              )}
              {["REQUESTED", "APPROVED"].includes(p.status) && (
                <form action={payoutDecisionAction.bind(null, p.id, "REJECT")} className="flex gap-2">
                  <Input name="note" placeholder="Reason shown to member" aria-label="Rejection reason" className="w-56" />
                  <Button variant="ghost" className="text-destructive">Reject</Button>
                </form>
              )}
            </div>
          )}
        </Card>
      ))}
    </>
  );
}
