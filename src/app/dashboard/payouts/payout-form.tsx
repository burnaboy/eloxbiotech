"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/forms/field";
import { payoutAction, saveAccountAction } from "../actions";

const amountSchema = z.object({ amount: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount like 5000 or 5000.50") });

/** Amount checks (minimum, available balance) happen on the server; the form only checks the format. */
export function PayoutForm({ requestKey, disabled }: { requestKey: string; disabled: boolean }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ error?: string; ok?: string } | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof amountSchema>>({ resolver: zodResolver(amountSchema) });
  return (
    <form noValidate className="space-y-4" onSubmit={handleSubmit((v) => start(async () => setRes(await payoutAction(v.amount, requestKey))))}>
      {res?.error && <Alert tone="error">{res.error}</Alert>}
      {res?.ok && <Alert tone="success">{res.ok}</Alert>}
      <Field id="amount" label="Amount (₦)" error={formState.errors.amount?.message}>
        <Input id="amount" inputMode="decimal" aria-invalid={!!formState.errors.amount} {...register("amount")} disabled={disabled} />
      </Field>
      <Button disabled={pending || disabled}>{pending ? "Submitting…" : "Request withdrawal"}</Button>
    </form>
  );
}

const accountSchema = z.object({
  bankCode: z.string().min(1, "Choose your bank"),
  accountNumber: z.string().trim().regex(/^\d{10}$/, "Enter your 10-digit account number"),
});

export function AccountForm({ banks, current }: { banks: { code: string; name: string }[]; current?: string }) {
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ error?: string; ok?: string } | null>(null);
  const { register, handleSubmit, formState, reset } = useForm<z.infer<typeof accountSchema>>({ resolver: zodResolver(accountSchema), defaultValues: { bankCode: current ?? "" } });
  const e = formState.errors;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit((v) =>
        start(async () => {
          const r = await saveAccountAction(v);
          setRes(r);
          if (r?.ok) reset({ bankCode: v.bankCode, accountNumber: "" });
        }),
      )}
    >
      {res?.error && <Alert tone="error">{res.error}</Alert>}
      {res?.ok && <Alert tone="success">{res.ok}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="bankCode" label="Bank" error={e.bankCode?.message}>
          <Select id="bankCode" aria-invalid={!!e.bankCode} {...register("bankCode")}>
            <option value="">Choose your bank</option>
            {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
          </Select>
        </Field>
        <Field id="accountNumber" label="Account number (NUBAN)" error={e.accountNumber?.message}>
          <Input id="accountNumber" inputMode="numeric" autoComplete="off" maxLength={10} aria-invalid={!!e.accountNumber} {...register("accountNumber")} />
        </Field>
      </div>
      <Button variant="outline" disabled={pending}>{pending ? "Checking the account…" : "Save bank account"}</Button>
    </form>
  );
}
