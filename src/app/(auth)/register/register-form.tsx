"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/forms/field";
import { registerAction } from "../actions";

const schema = z
  .object({
    name: z.string().trim().min(2, "Enter your full name"),
    email: z.string().email("Enter a valid email"),
    phone: z.string().optional(),
    password: z.string().min(10, "At least 10 characters").regex(/[A-Za-z]/, "Include a letter").regex(/[0-9]/, "Include a number"),
    confirm: z.string(),
    referralCode: z.string().optional(),
    leg: z.enum(["", "LEFT", "RIGHT"]).optional(),
    joinAsAffiliate: z.boolean(),
    agree: z.literal(true, { errorMap: () => ({ message: "You must accept the terms" }) }),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

export function RegisterForm({ referralCode, leg, sponsorName }: { referralCode?: string; leg?: string; sponsorName?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const { register, handleSubmit, watch, formState } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { referralCode: referralCode ?? "", leg: (leg as "LEFT" | "RIGHT") ?? "", joinAsAffiliate: false },
  });
  const e = formState.errors;
  const affiliate = watch("joinAsAffiliate");
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit((v) =>
        start(async () => {
          const res = await registerAction({
            name: v.name,
            email: v.email,
            phone: v.phone,
            password: v.password,
            referralCode: v.referralCode,
            leg: v.leg ? v.leg : null,
            joinAsAffiliate: v.joinAsAffiliate,
          });
          setError(res?.error);
        }),
      )}
    >
      {error && <Alert tone="error">{error}</Alert>}
      {sponsorName && <Alert>You were invited by <strong>{sponsorName}</strong>.</Alert>}
      <Field id="name" label="Full name" error={e.name?.message}>
        <Input id="name" autoComplete="name" aria-invalid={!!e.name} {...register("name")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="email" label="Email" error={e.email?.message}>
          <Input id="email" type="email" autoComplete="email" aria-invalid={!!e.email} {...register("email")} />
        </Field>
        <Field id="phone" label="Phone (optional)">
          <Input id="phone" type="tel" autoComplete="tel" {...register("phone")} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="password" label="Password" error={e.password?.message} hint="10+ characters with a letter and a number">
          <Input id="password" type="password" autoComplete="new-password" aria-invalid={!!e.password} {...register("password")} />
        </Field>
        <Field id="confirm" label="Confirm password" error={e.confirm?.message}>
          <Input id="confirm" type="password" autoComplete="new-password" aria-invalid={!!e.confirm} {...register("confirm")} />
        </Field>
      </div>
      <Field id="referralCode" label="Referral code (optional)">
        <Input id="referralCode" className="uppercase" {...register("referralCode")} />
      </Field>
      <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--primary))]" {...register("joinAsAffiliate")} />
        <span>
          <span className="font-medium">Join as an affiliate</span>
          <span className="block text-muted-foreground">Share product links and earn commissions on completed sales. Joining is free and there is no purchase requirement.</span>
        </span>
      </label>
      {affiliate && (
        <Field id="leg" label="Placement side" hint="Leave as automatic unless your sponsor told you a side.">
          <Select id="leg" {...register("leg")}>
            <option value="">Automatic</option>
            <option value="LEFT">Left</option>
            <option value="RIGHT">Right</option>
          </Select>
        </Field>
      )}
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4" aria-invalid={!!e.agree} {...register("agree")} />
        <span>
          I agree to the terms and have read the <a href="/compensation" target="_blank" className="text-primary underline">compensation plan</a>.
        </span>
      </label>
      {e.agree && <p className="text-xs text-destructive">{e.agree.message}</p>}
      <Button className="w-full" disabled={pending}>{pending ? "Creating account…" : "Create account"}</Button>
    </form>
  );
}
