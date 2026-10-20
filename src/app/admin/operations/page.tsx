import { requireSuperAdmin } from "@/lib/session";
import { ReasonFields } from "@/components/admin/high-risk";
import { prisma } from "@/lib/db";
import { getOps } from "@/lib/settings";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Flash } from "@/components/flash";
import { resetMfaAction, revokeAllSessionsAction, saveOpsAction } from "../actions";

export default async function Operations({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await requireSuperAdmin();
  const [ops, emails] = await Promise.all([getOps(), prisma.emailOutbox.findMany({ orderBy: { createdAt: "desc" }, take: 20 })]);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Emergency operations</h1>
      <Flash sp={await searchParams} />
      <Card>
        <CardHeader><CardTitle>Pause switches</CardTitle><CardDescription>Use during an incident, a payment problem or an investigation. Each change needs a fresh code and is logged.</CardDescription></CardHeader>
        <CardContent>
          <form action={saveOpsAction} className="space-y-3 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="checkoutPaused" defaultChecked={ops.checkoutPaused} className="h-4 w-4" /> Pause checkout (browsing still works)</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="payoutsPaused" defaultChecked={ops.payoutsPaused} className="h-4 w-4" /> Pause payout requests and payments</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="commissionsPaused" defaultChecked={ops.commissionsPaused} className="h-4 w-4" /> Pause commission approval and binary runs</label>
            <div className="space-y-1"><label htmlFor="notice">Site-wide notice (optional)</label><Input id="notice" name="notice" defaultValue={ops.notice} placeholder="e.g. Checkout is paused for maintenance until 3pm." /></div>
            <div className="max-w-md"><ReasonFields idPrefix="ops" /></div>
            <Button>Save</Button>
          </form>
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Reset a member's two-step verification</CardTitle><CardDescription>Only after confirming their identity another way. They are signed out and must set it up again.</CardDescription></CardHeader>
          <CardContent>
            <form action={resetMfaAction} className="space-y-2">
              <Input name="email" type="email" placeholder="Member email" aria-label="Member email" required />
              <ReasonFields idPrefix="mfa" confirm="RESET" reasonLabel="How you confirmed their identity" />
              <Button variant="destructive">Reset</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Sign everyone out</CardTitle><CardDescription>For a suspected breach. Everyone except you must sign in again.</CardDescription></CardHeader>
          <CardContent>
            <form action={revokeAllSessionsAction} className="space-y-2">
              <ReasonFields idPrefix="signout" confirm="SIGN OUT EVERYONE" />
              <Button variant="destructive">Sign everyone out</Button>
            </form>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Recent emails</CardTitle><CardDescription>Outgoing mail log. With no email provider set, messages stay here.</CardDescription></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {emails.map((e) => (
            <details key={e.id} className="border-b py-1">
              <summary className="cursor-pointer">{formatDate(e.createdAt)} · {e.to} · {e.subject} · {e.sentAt ? "sent" : e.error ? `failed: ${e.error}` : "queued"}</summary>
              <pre className="whitespace-pre-wrap p-2 text-xs text-muted-foreground">{e.body.replace(/\/(reset-password|verify-email)\/[A-Za-z0-9_-]+/g, "/$1/••••••")}</pre>
            </details>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
