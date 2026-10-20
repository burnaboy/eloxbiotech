"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/forms/field";
import { loginAction } from "../actions";

const schema = z.object({ email: z.string().email("Enter a valid email"), password: z.string().min(1, "Enter your password") });

export function LoginForm({ next }: { next?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  const e = formState.errors;
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit((v) => start(async () => setError((await loginAction({ ...v, next }))?.error)))}
    >
      {error && <Alert tone="error">{error}</Alert>}
      <Field id="email" label="Email" error={e.email?.message}>
        <Input id="email" type="email" autoComplete="email" aria-invalid={!!e.email} {...register("email")} />
      </Field>
      <Field id="password" label="Password" error={e.password?.message}>
        <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!e.password} {...register("password")} />
      </Field>
      <Button className="w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
    </form>
  );
}
