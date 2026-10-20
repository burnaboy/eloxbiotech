"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setQuantityAction } from "@/app/(shop)/actions";

export function CartQuantity({ productId, variantId, quantity, max }: { productId: string; variantId: string | null; quantity: number; max: number }) {
  const [pending, start] = useTransition();
  const set = (q: number) => start(async () => { await setQuantityAction(productId, q, variantId); });
  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor={`qty-${productId}-${variantId ?? ""}`}>Quantity</label>
      <select
        id={`qty-${productId}-${variantId ?? ""}`}
        className="h-9 rounded-md border bg-card px-2 text-sm"
        value={quantity}
        disabled={pending}
        onChange={(e) => set(Number(e.target.value))}
      >
        {Array.from({ length: Math.max(quantity, Math.min(max, 20), 1) }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      <Button variant="ghost" size="icon" aria-label="Remove" disabled={pending} onClick={() => set(0)}><Trash2 /></Button>
    </div>
  );
}
