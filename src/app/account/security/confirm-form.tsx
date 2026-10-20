"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { confirmMfaAction } from "../actions";

export function ConfirmMfaForm() {
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ error?: string; ok?: string; recovery?: string[] } | null>(null);
  if (res?.recovery?.length) {
    return (
      <div className="space-y-3">
        <Alert tone="success">Two-step verification is on.</Alert>
        <p className="text-sm">Save these recovery codes somewhere safe. Each works once if you lose your phone. They won't be shown again.</p>
        <ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted p-4 font-mono text-sm">{res.recovery.map((c) => <li key={c}>{c}</li>)}</ul>
        <Button asChild><a href="/account/security">Done</a></Button>
      </div>
    );
  }
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); start(async () => setRes(await confirmMfaAction(code))); }}>
      {res?.error && <Alert tone="error">{res.error}</Alert>}
      <div className="space-y-1.5">
        <Label htmlFor="code">Code from the app</Label>
        <Input id="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} className="max-w-40" />
      </div>
      <Button disabled={pending || code.length !== 6}>{pending ? "Checking…" : "Turn on"}</Button>
    </form>
  );
}
