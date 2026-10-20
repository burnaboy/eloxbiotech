"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/forms/field";
import { checkoutAction } from "../actions";

const schema = z.object({
  shipName: z.string().trim().min(2, "Enter the recipient's name"),
  shipPhone: z.string().trim().min(7, "Enter a phone number"),
  shipLine1: z.string().trim().min(3, "Enter the street address"),
  shipLine2: z.string().optional(),
  shipCity: z.string().trim().min(2, "Enter the city"),
  shipState: z.string().trim().min(2, "Enter the state"),
  shipCountry: z.string().trim().min(2),
  shipPostal: z.string().optional(),
});
type V = z.infer<typeof schema>;

export function CheckoutForm({ defaults }: { defaults: Partial<V> }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const { register, handleSubmit, formState } = useForm<V>({ resolver: zodResolver(schema), defaultValues: { shipCountry: "Nigeria", ...defaults } });
  const e = formState.errors;
  const f = (k: keyof V, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field id={k} label={label} error={e[k]?.message}>
      <Input id={k} aria-invalid={!!e[k]} {...props} {...register(k)} />
    </Field>
  );
  return (
    <form noValidate className="space-y-4" onSubmit={handleSubmit((v) => start(async () => setError((await checkoutAction(v))?.error)))}>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        {f("shipName", "Recipient name", { autoComplete: "name" })}
        {f("shipPhone", "Phone", { autoComplete: "tel", type: "tel" })}
      </div>
      {f("shipLine1", "Address", { autoComplete: "address-line1" })}
      {f("shipLine2", "Apartment, landmark (optional)", { autoComplete: "address-line2" })}
      <div className="grid gap-4 sm:grid-cols-3">
        {f("shipCity", "City", { autoComplete: "address-level2" })}
        {f("shipState", "State", { autoComplete: "address-level1" })}
        {f("shipPostal", "Postal code (optional)", { autoComplete: "postal-code" })}
      </div>
      {f("shipCountry", "Country", { autoComplete: "country-name" })}
      <Button size="lg" className="w-full" disabled={pending}><Lock /> {pending ? "Reserving your items…" : "Continue to secure payment"}</Button>
      <p className="text-center text-xs text-muted-foreground">Items are held for you while you pay. Unpaid orders are released automatically.</p>
    </form>
  );
}
