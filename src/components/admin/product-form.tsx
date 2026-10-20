"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/forms/field";
import { productFormSchema, type ProductFormValues } from "@/lib/product-input";
import { saveProductAction } from "@/app/admin/actions";

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-lg border p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

export function ProductForm({
  id, defaults, categories, showCosts, hasVariants,
}: { id?: string; defaults?: Partial<ProductFormValues>; categories: { id: string; name: string }[]; showCosts: boolean; hasVariants?: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const { register, handleSubmit, formState, setValue, getValues } = useForm<ProductFormValues>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      status: "DRAFT", featured: false, pv: "0", lowStockThreshold: "5", weightGrams: "", shippable: true, categoryId: "",
      salePrice: "", saleStartsAt: "", saleEndsAt: "", costPrice: "", lengthCm: "", widthCm: "", heightCm: "",
      metaTitle: "", metaDescription: "", attributes: "", initialStock: "0", ...defaults,
    },
  });
  const e = formState.errors;
  const f = (k: keyof ProductFormValues, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, hint?: string) => (
    <Field id={k} label={label} error={e[k]?.message as string | undefined} hint={hint}>
      <Input id={k} aria-invalid={!!e[k]} aria-describedby={e[k] ? `${k}-error` : undefined} {...props} {...register(k)} />
    </Field>
  );
  return (
    <form noValidate className="space-y-5" onSubmit={handleSubmit((v) => start(async () => setError((await saveProductAction(id ?? null, v))?.error)))}>
      {error && <Alert tone="error">{error}</Alert>}
      <Section title="Basics">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="name" label="Name" error={e.name?.message}>
            <Input id="name" aria-invalid={!!e.name} {...register("name", { onBlur: () => !getValues("slug") && setValue("slug", slugify(getValues("name"))) })} />
          </Field>
          {f("slug", "URL slug", {}, "Used in the product link")}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {f("sku", "SKU")}
          <Field id="categoryId" label="Category">
            <Select id="categoryId" {...register("categoryId")}>
              <option value="">None</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field id="status" label="Publication status" hint="Only active products appear in the shop">
            <Select id="status" {...register("status")}>
              <option value="DRAFT">Draft</option>
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
            </Select>
          </Field>
        </div>
        <Field id="description" label="Description" error={e.description?.message}>
          <Textarea id="description" rows={6} aria-invalid={!!e.description} {...register("description")} />
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" {...register("featured")} /> Featured on homepage</label>
      </Section>

      <Section title="Pricing (₦)">
        <div className="grid gap-4 sm:grid-cols-4">
          {f("price", "Regular price", { inputMode: "decimal" }, hasVariants ? "Options can override this" : undefined)}
          {f("salePrice", "Sale price", { inputMode: "decimal" }, "Leave empty for no sale")}
          {f("saleStartsAt", "Sale starts", { type: "datetime-local" }, "Lagos time, optional")}
          {f("saleEndsAt", "Sale ends", { type: "datetime-local" }, "Lagos time, optional")}
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          {f("pv", "Product volume (PV)", { inputMode: "numeric" }, "Points for commissions")}
          {showCosts && f("costPrice", "Cost price", { inputMode: "decimal" }, "Visible only to staff with cost access")}
        </div>
      </Section>

      <Section title="Stock and shipping">
        <div className="grid gap-4 sm:grid-cols-4">
          {f("lowStockThreshold", "Low-stock alert at", { inputMode: "numeric" })}
          {!id && !hasVariants && f("initialStock", "Opening stock", { inputMode: "numeric" })}
          {f("weightGrams", "Weight (g)", { inputMode: "numeric" })}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {f("lengthCm", "Package length (cm)", { inputMode: "decimal" })}
          {f("widthCm", "Package width (cm)", { inputMode: "decimal" })}
          {f("heightCm", "Package height (cm)", { inputMode: "decimal" })}
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" {...register("shippable")} /> Can be delivered (untick to stop sales without hiding the product)</label>
      </Section>

      <Section title="Details and search">
        <Field id="attributes" label="Product facts" hint={'One per line, like "Brand: Acme" or "NAFDAC No.: A1-2345". Shown on the product page.'} error={e.attributes?.message}>
          <Textarea id="attributes" rows={4} {...register("attributes")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {f("metaTitle", "Search title", {}, "Optional, defaults to the name")}
          {f("metaDescription", "Search description", {}, "Optional, up to 160 characters")}
        </div>
      </Section>

      <Button disabled={pending}>{pending ? "Saving…" : "Save product"}</Button>
    </form>
  );
}
