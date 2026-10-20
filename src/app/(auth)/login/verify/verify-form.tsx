"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { verifyCodeAction } from "../../actions";

export function VerifyForm({ next, submitLabel = "Verify" }: { next?: string; submitLabel?: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setError((await verifyCodeAction({ code, next }))?.error));
      }}
    >
      {error && <Alert tone="error">{error}</Alert>}
      <div className="space-y-1.5">
        <Label htmlFor="code">Authentication code</Label>
        <Input id="code" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
        <p className="text-xs text-muted-foreground">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
      </div>
      <Button className="w-full" disabled={pending || code.length < 6}>{pending ? "Checking…" : submitLabel}</Button>
    </form>
  );
}
