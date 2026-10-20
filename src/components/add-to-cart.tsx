"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Minus, Plus, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Price } from "@/components/price";
import { addToCartAction } from "@/app/(shop)/actions";

export interface VariantChoice {
  id: string;
  name: string;
  unitMinor: number;
  compareAtMinor: number | null;
  stock: number;
}

/**
 * Quantity and option picker. Prices shown here are for display only: the server recomputes everything
 * from product records when the item is added and again at checkout.
 */
export function AddToCart({ productId, max, returnTo, variants, currency }: { productId: string; max: number; returnTo: string; variants?: VariantChoice[]; currency: string }) {
  const hasVariants = !!variants?.length;
  const firstInStock = variants?.find((v) => v.stock > 0) ?? variants?.[0];
  const [variantId, setVariantId] = useState<string | null>(firstInStock?.id ?? null);
  const [qty, setQty] = useState(1);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);
  const chosen = variants?.find((v) => v.id === variantId) ?? null;
  const limit = Math.min(99, hasVariants ? (chosen?.stock ?? 0) : max);
  const allSoldOut = hasVariants ? variants!.every((v) => v.stock <= 0) : max <= 0;
  if (allSoldOut) return <Alert>This product is sold out.</Alert>;
  return (
    <div className="space-y-3">
      {hasVariants && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Choose an option</legend>
          <div className="flex flex-wrap gap-2">
            {variants!.map((v) => (
              <label
                key={v.id}
                className={`cursor-pointer rounded-md border px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${variantId === v.id ? "border-primary bg-primary/10" : "bg-card"} ${v.stock <= 0 ? "opacity-50" : ""}`}
              >
                <input type="radio" name="variant" value={v.id} className="sr-only" checked={variantId === v.id} disabled={v.stock <= 0} onChange={() => { setVariantId(v.id); setQty(1); setMsg(null); }} />
                {v.name}{v.stock <= 0 ? " (sold out)" : ""}
              </label>
            ))}
          </div>
          {chosen && <p className="text-lg"><Price unitMinor={chosen.unitMinor} compareAtMinor={chosen.compareAtMinor} currency={currency} /></p>}
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-md border" role="group" aria-label="Quantity">
          <Button type="button" variant="ghost" size="icon" aria-label="Decrease quantity" onClick={() => setQty((q) => Math.max(1, q - 1))}><Minus /></Button>
          <span className="w-10 text-center tabular-nums" aria-live="polite">{qty}</span>
          <Button type="button" variant="ghost" size="icon" aria-label="Increase quantity" onClick={() => setQty((q) => Math.min(limit, q + 1))}><Plus /></Button>
        </div>
        <Button size="lg" disabled={pending || limit <= 0} onClick={() => start(async () => setMsg(await addToCartAction(productId, qty, returnTo, variantId)))}>
          <ShoppingCart /> {pending ? "Adding…" : "Add to cart"}
        </Button>
      </div>
      {msg?.error && <Alert tone="error">{msg.error}</Alert>}
      {msg?.ok && <Alert tone="success">{msg.ok}. <Link href="/cart" className="underline">View cart</Link></Alert>}
    </div>
  );
}
