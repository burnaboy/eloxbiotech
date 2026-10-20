import QRCode from "qrcode";
import { ShieldCheck } from "lucide-react";
import { requireUser } from "@/lib/session";
import { decrypt } from "@/lib/crypto";
import { otpauthUri } from "@/lib/totp";
import { getBrand } from "@/lib/settings";
import { mfaRequired } from "@/lib/mfa";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Flash } from "@/components/flash";
import { ConfirmMfaForm } from "./confirm-form";
import { disableMfaAction, startMfaAction } from "../actions";

export const metadata = { title: "Security" };

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ required?: string; setup?: string; ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser("/account/security");
  const brand = await getBrand();
  const settingUp = !user.mfaEnabledAt && !!user.mfaSecretEnc && sp.setup;
  let qr = "", secret = "";
  if (settingUp) {
    secret = decrypt(user.mfaSecretEnc!);
    qr = await QRCode.toDataURL(otpauthUri(secret, user.email, brand.companyName), { margin: 1, width: 200 });
  }
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
      <Flash sp={sp} />
      {sp.required && !user.mfaEnabledAt && <Alert tone="error">Administrator accounts must turn on two-step verification before using the admin area.</Alert>}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" aria-hidden /> Two-step verification</CardTitle>
          <CardDescription>Use an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password) for a code at sign-in.{mfaRequired(user.role) ? " Required for your role." : ""}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {user.mfaEnabledAt ? (
            <>
              <Alert tone="success">On since {user.mfaEnabledAt.toLocaleDateString("en-NG")}. {user.mfaRecoveryHashes.length} recovery codes left.</Alert>
              {!mfaRequired(user.role) && (
                <form action={disableMfaAction} className="flex items-end gap-2">
                  <div className="space-y-1"><label htmlFor="off-code" className="text-sm">Current code</label><Input id="off-code" name="code" className="max-w-40" /></div>
                  <Button variant="outline">Turn off</Button>
                </form>
              )}
            </>
          ) : settingUp ? (
            <div className="grid gap-6 sm:grid-cols-[200px_1fr]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="QR code to add this account to your authenticator app" className="rounded-md border bg-white p-2" width={200} height={200} />
              <div className="space-y-3 text-sm">
                <p>1. Scan the QR code with your authenticator app. If you can't scan, enter this key:</p>
                <code className="block break-all rounded bg-muted p-2">{secret}</code>
                <p>2. Enter the 6-digit code the app shows.</p>
                <ConfirmMfaForm />
              </div>
            </div>
          ) : (
            <form action={startMfaAction}><Button>Set up two-step verification</Button></form>
          )}
        </CardContent>
      </Card>
    </>
  );
}
