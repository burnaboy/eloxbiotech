"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/forms/field";
import { saveProductAction } from "@/app/admin/actions";

const schema = z.object({
  name: z.string().trim().min(2, "Name is required"),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/, "Lowercase letters, numbers and dashes"),
  sku: z.string().trim().min(2, "SKU is required"),
  description: z.string().trim().min(10, "At least 10 characters"),
  price: z.coerce.number().positive("Price must be above zero"),
  pv: z.coerce.number().int().min(0),
  lowStockThreshold: z.coerce.number().int().min(0),
  weightGrams: z.coerce.number().int().min(0),
  imageUrl: z.string().trim().url("Enter a full URL").or(z.literal("")),
  images: z.string(),
  categoryId: z.string(),
  active: z.boolean(),
  featured: z.boolean(),
  initialStock: z.coerce.number().int().min(0).optional(),
});
type V = z.input<typeof schema>;

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function ProductForm({ id, defaults, categories }: { id?: string; defaults?: Partial<V>; categories: { id: string; name: string }[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const { register, handleSubmit, formState, setValue, getValues } = useForm<V>({
    resolver: zodResolver(schema),
    defaultValues: { active: true, featured: false, pv: 0, lowStockThreshold: 5, weightGrams: 0, imageUrl: "", images: "", categoryId: "", initialStock: 0, ...defaults },
  });
  const e = formState.errors;
  const f = (k: keyof V, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <Field id={k} label={label} error={e[k]?.message as string | undefined} hint={hint}>
      <Input id={k} aria-invalid={!!e[k]} {...props} {...register(k)} />
    </Field>
  );
  return (
    <form noValidate className="space-y-4" onSubmit={handleSubmit((v) => start(async () => setError((await saveProductAction(id ?? null, v))?.error)))}>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Name" error={e.name?.message}>
          <Input id="name" aria-invalid={!!e.name} {...register("name", { onBlur: () => !getValues("slug") && setValue("slug", slugify(getValues("name"))) })} />
        </Field>
        {f("slug", "URL slug", {}, "Used in the product link")}
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        {f("sku", "SKU")}
        {f("price", "Price (₦)", { inputMode: "decimal" })}
        {f("pv", "Product volume (PV)", { inputMode: "numeric" }, "Points for commissions")}
        <Field id="categoryId" label="Category">
          <Select id="categoryId" {...register("categoryId")}>
            <option value="">None</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
      </div>
      <Field id="description" label="Description" error={e.description?.message}>
        <Textarea id="description" rows={6} aria-invalid={!!e.description} {...register("description")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {f("imageUrl", "Main image URL", { placeholder: "https://…" })}
        <Field id="images" label="Gallery image URLs" hint="One per line, up to 8">
          <Textarea id="images" rows={3} {...register("images")} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {f("lowStockThreshold", "Low-stock alert at", { inputMode: "numeric" })}
        {f("weightGrams", "Weight (g)", { inputMode: "numeric" })}
        {!id && f("initialStock", "Opening stock", { inputMode: "numeric" })}
      </div>
      <div className="flex gap-6 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" {...register("active")} /> Visible in shop</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" {...register("featured")} /> Featured on homepage</label>
      </div>
      <Button disabled={pending}>{pending ? "Saving…" : "Save product"}</Button>
    </form>
  );
}
