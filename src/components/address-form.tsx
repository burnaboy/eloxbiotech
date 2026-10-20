"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/forms/field";
import { saveAddressAction } from "@/app/account/actions";

const schema = z.object({
  label: z.string().trim().min(1, "e.g. Home or Office"),
  name: z.string().trim().min(2, "Enter a name"),
  phone: z.string().trim().min(5, "Enter a phone number"),
  line1: z.string().trim().min(3, "Enter the street address"),
  line2: z.string().optional(),
  city: z.string().trim().min(2, "Enter the city"),
  state: z.string().trim().min(2, "Enter the state"),
  country: z.string().trim().min(2),
  postal: z.string().optional(),
  isDefault: z.boolean(),
});
type V = z.infer<typeof schema>;

export function AddressForm({ id, defaults, onDone }: { id?: string; defaults?: Partial<V>; onDone?: () => void }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);
  const { register, handleSubmit, formState, reset } = useForm<V>({ resolver: zodResolver(schema), defaultValues: { country: "Nigeria", isDefault: false, ...defaults } });
  const e = formState.errors;
  const f = (k: keyof Omit<V, "isDefault">, label: string) => (
    <Field id={`${id ?? "new"}-${k}`} label={label} error={e[k]?.message}>
      <Input id={`${id ?? "new"}-${k}`} aria-invalid={!!e[k]} {...register(k)} />
    </Field>
  );
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit((v) =>
        start(async () => {
          const r = await saveAddressAction(id ?? null, v);
          setMsg(r);
          if (r?.ok && !id) reset();
          if (r?.ok) onDone?.();
        }),
      )}
    >
      {msg?.error && <Alert tone="error">{msg.error}</Alert>}
      {msg?.ok && <Alert tone="success">{msg.ok}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">{f("label", "Label")}{f("name", "Recipient")}{f("phone", "Phone")}</div>
      <div className="grid gap-4 sm:grid-cols-2">{f("line1", "Address")}{f("line2", "Apartment, landmark (optional)")}</div>
      <div className="grid gap-4 sm:grid-cols-4">{f("city", "City")}{f("state", "State")}{f("country", "Country")}{f("postal", "Postal code")}</div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" {...register("isDefault")} /> Use as default</label>
      <Button disabled={pending}>{pending ? "Saving…" : "Save address"}</Button>
    </form>
  );
}
