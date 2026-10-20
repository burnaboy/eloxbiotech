"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Minus, Plus, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { addToCartAction } from "@/app/(shop)/actions";

export function AddToCart({ productId, max, returnTo }: { productId: string; max: number; returnTo: string }) {
  const [qty, setQty] = useState(1);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ error?: string; ok?: string } | null>(null);
  if (max <= 0) return <Alert>This product is sold out.</Alert>;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-md border" role="group" aria-label="Quantity">
          <Button type="button" variant="ghost" size="icon" aria-label="Decrease quantity" onClick={() => setQty((q) => Math.max(1, q - 1))}><Minus /></Button>
          <span className="w-10 text-center tabular-nums" aria-live="polite">{qty}</span>
          <Button type="button" variant="ghost" size="icon" aria-label="Increase quantity" onClick={() => setQty((q) => Math.min(max, q + 1))}><Plus /></Button>
        </div>
        <Button size="lg" disabled={pending} onClick={() => start(async () => setMsg(await addToCartAction(productId, qty, returnTo)))}>
          <ShoppingCart /> {pending ? "Adding…" : "Add to cart"}
        </Button>
      </div>
      {msg?.error && <Alert tone="error">{msg.error}</Alert>}
      {msg?.ok && <Alert tone="success">{msg.ok}. <Link href="/cart" className="underline">View cart</Link></Alert>}
    </div>
  );
}
