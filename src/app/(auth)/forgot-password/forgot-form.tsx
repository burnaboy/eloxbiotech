"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { forgotPasswordAction } from "../actions";

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [res, setRes] = useState<{ ok?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  if (res?.ok) return <Alert tone="success">{res.ok}</Alert>;
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); start(async () => setRes(await forgotPasswordAction({ email }))); }}>
      {res?.error && <Alert tone="error">{res.error}</Alert>}
      <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <Button className="w-full" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</Button>
    </form>
  );
}
