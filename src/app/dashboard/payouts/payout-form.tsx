"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/forms/field";
import { payoutAction } from "../actions";

export function PayoutForm({ availableMajor, minMajor }: { availableMajor: number; minMajor: number }) {
  const schema = z.object({
    amount: z.coerce.number().min(minMajor, `Minimum is ${minMajor.toLocaleString()}`).max(availableMajor, "More than your balance"),
    method: z.enum(["BANK_TRANSFER", "MOBILE_MONEY"]),
    destination: z.string().trim().min(4, "Enter your account details"),
  });
  const [pending, start] = useTransition();
  const [res, setRes] = useState<{ error?: string; ok?: string } | null>(null);
  const { register, handleSubmit, formState, reset } = useForm<z.input<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { method: "BANK_TRANSFER" } });
  const e = formState.errors;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit((v) =>
        start(async () => {
          const r = await payoutAction({ amount: String(v.amount), method: v.method, destination: v.destination });
          setRes(r);
          if (r?.ok) reset();
        }),
      )}
    >
      {res?.error && <Alert tone="error">{res.error}</Alert>}
      {res?.ok && <Alert tone="success">{res.ok}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="amount" label="Amount" error={e.amount?.message}>
          <Input id="amount" inputMode="decimal" aria-invalid={!!e.amount} {...register("amount")} />
        </Field>
        <Field id="method" label="Method">
          <Select id="method" {...register("method")}>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="MOBILE_MONEY">Mobile money</option>
          </Select>
        </Field>
      </div>
      <Field id="destination" label="Account details" error={e.destination?.message} hint="Bank name, account number and account name">
        <Input id="destination" aria-invalid={!!e.destination} {...register("destination")} />
      </Field>
      <Button disabled={pending || availableMajor < minMajor}>{pending ? "Submitting…" : "Request payout"}</Button>
    </form>
  );
}
