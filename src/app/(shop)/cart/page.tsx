import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getCart } from "@/lib/orders";
import { getBrand } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/ui/table";
import { Alert } from "@/components/ui/alert";
import { ProductImage } from "@/components/product-card";
import { CartQuantity } from "@/components/cart-line";
import { Price } from "@/components/price";
import { Input } from "@/components/ui/input";
import { cartCode } from "@/lib/cart-code";
import { applyDiscountAction, removeDiscountAction } from "../actions";

export const metadata = { title: "Cart" };

export default async function CartPage() {
  const user = await requireUser("/cart");
  const code = await cartCode();
  const [cart, brand] = await Promise.all([getCart(user.id, code), getBrand()]);
  const m = (v: number) => formatMoney(v, brand.currency);
  const short = cart.items.filter((i) => i.problem);
  return (
    <div className="container py-10">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Your cart</h1>
      {cart.items.length === 0 ? (
        <Empty>Your cart is empty. <Link href="/" className="text-primary underline">Browse products</Link></Empty>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
          <ul className="divide-y rounded-lg border bg-card">
            {cart.items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-4 p-4">
                <ProductImage image={i.product.images[0]} name={i.product.name} className="!w-20 rounded-md" />
                <div className="min-w-0 flex-1">
                  <Link href={`/products/${i.product.slug}`} className="font-medium hover:underline">{i.product.name}</Link>
                  {i.variant && <p className="text-sm">{i.variant.name}</p>}
                  <p className="text-sm text-muted-foreground"><Price unitMinor={i.unitMinor} compareAtMinor={i.compareAtMinor} currency={brand.currency} /> each</p>
                  {i.problem && <p className="text-sm font-medium text-destructive">{i.problem}</p>}
                </div>
                <CartQuantity productId={i.productId} variantId={i.variantId} quantity={i.quantity} max={i.variant ? i.variant.stock : i.product.stock} />
                <p className="w-28 text-right font-medium tabular-nums">{formatMoney(i.lineMinor, brand.currency)}</p>
              </li>
            ))}
          </ul>
          <Card className="h-fit">
            <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Subtotal" value={m(cart.subtotalMinor)} />
              {cart.discountMinor > 0 && <Row label={`Discount (${cart.discountCode})`} value={`−${m(cart.discountMinor)}`} />}
              <Row label="Delivery" value={cart.shippingMinor ? m(cart.shippingMinor) : "Free"} />
              {cart.taxMinor > 0 && !cart.taxIncluded && <Row label={cart.taxLabel} value={m(cart.taxMinor)} />}
              <div className="border-t pt-3"><Row label="Total" value={m(cart.totalMinor)} bold /></div>
              {cart.taxMinor > 0 && cart.taxIncluded && <p className="text-xs text-muted-foreground">Includes {cart.taxLabel} of {m(cart.taxMinor)}</p>}
              {cart.discountCode ? (
                <form action={removeDiscountAction} className="flex items-center justify-between gap-2 text-xs">
                  <span>{cart.discountDescription}</span>
                  <Button variant="ghost" size="sm">Remove code</Button>
                </form>
              ) : (
                <form action={applyDiscountAction} className="flex gap-2">
                  <Input name="code" aria-label="Discount code" placeholder="Discount code" defaultValue={code ?? ""} maxLength={40} autoCapitalize="characters" />
                  <Button variant="outline">Apply</Button>
                </form>
              )}
              {cart.discountError && <p className="text-xs text-destructive">{cart.discountError}</p>}
              {short.length > 0 && <Alert tone="error">Some items are no longer available in that quantity. Adjust them to continue.</Alert>}
              <Button asChild className="w-full" size="lg" disabled={short.length > 0}>
                {short.length > 0 ? <span>Checkout</span> : <Link href="/checkout">Checkout</Link>}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return <div className={`flex justify-between ${bold ? "text-base font-semibold" : ""}`}><span>{label}</span><span className="tabular-nums">{value}</span></div>;
}
