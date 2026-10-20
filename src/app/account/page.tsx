import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Flash } from "@/components/flash";
import { changePasswordAction, resendVerificationAction, savePrefsAction, updateProfileAction } from "./actions";
import { Alert } from "@/components/ui/alert";

export const metadata = { title: "Account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; welcome?: string }> }) {
  const user = await requireUser("/account");
  const sponsor = user.sponsorId ? await prisma.user.findUnique({ where: { id: user.sponsorId }, select: { name: true, referralCode: true } }) : null;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
      {(await searchParams).welcome && <Alert tone="success">Welcome! Your account is ready.</Alert>}
      <Flash sp={await searchParams} />
      {!user.emailVerifiedAt && (
        <Alert tone="error">
          Please confirm your email address. We sent a link to {user.email}. You need to confirm it before checking out or requesting payouts.
          <form action={resendVerificationAction} className="mt-2"><Button size="sm" variant="outline">Resend the link</Button></form>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Your details</CardTitle>
          <CardDescription>{user.email} · member code {user.referralCode}{sponsor ? ` · sponsored by ${sponsor.name}` : ""}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateProfileAction} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="name">Full name</Label><Input id="name" name="name" defaultValue={user.name} required minLength={2} /></div>
            <div className="space-y-1.5"><Label htmlFor="phone">Phone</Label><Input id="phone" name="phone" type="tel" defaultValue={user.phone ?? ""} /></div>
            <div><Button>Save</Button></div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Email preferences</CardTitle><CardDescription>Security, sign-in and payout emails are always sent.</CardDescription></CardHeader>
        <CardContent>
          <form action={savePrefsAction} className="space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" name="emailOrderUpdates" defaultChecked={user.emailOrderUpdates} className="h-4 w-4" /> Order and delivery updates</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="emailCommissionUpdates" defaultChecked={user.emailCommissionUpdates} className="h-4 w-4" /> Commission updates (affiliates)</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="emailMarketing" defaultChecked={user.emailMarketing} className="h-4 w-4" /> News and offers</label>
            <Button variant="outline" className="mt-2">Save preferences</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Change password</CardTitle><CardDescription>You'll stay signed in here; other devices are signed out.</CardDescription></CardHeader>
        <CardContent>
          <form action={changePasswordAction} className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5"><Label htmlFor="current">Current password</Label><Input id="current" name="current" type="password" autoComplete="current-password" required /></div>
            <div className="space-y-1.5"><Label htmlFor="newPassword">New password</Label><Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={10} /></div>
            <div className="space-y-1.5"><Label htmlFor="confirm">Confirm</Label><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required /></div>
            <div><Button>Change password</Button></div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
