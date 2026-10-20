"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { resetPasswordAction } from "../../actions";

export function ResetForm({ token }: { token: string }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (pw !== confirm) return setError("Passwords don't match.");
        start(async () => setError((await resetPasswordAction({ token, password: pw }))?.error));
      }}
    >
      {error && <Alert tone="error">{error}</Alert>}
      <div className="space-y-1.5"><Label htmlFor="pw">New password</Label><Input id="pw" type="password" autoComplete="new-password" minLength={10} required value={pw} onChange={(e) => setPw(e.target.value)} /><p className="text-xs text-muted-foreground">10+ characters with a letter and a number. You'll be signed out everywhere.</p></div>
      <div className="space-y-1.5"><Label htmlFor="confirm">Confirm</Label><Input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
      <Button className="w-full" disabled={pending}>{pending ? "Saving…" : "Save password"}</Button>
    </form>
  );
}
