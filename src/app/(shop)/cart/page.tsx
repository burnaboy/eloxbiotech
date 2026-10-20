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

export const metadata = { title: "Cart" };

export default async function CartPage() {
  const user = await requireUser("/cart");
  const [cart, brand] = await Promise.all([getCart(user.id), getBrand()]);
  const short = cart.items.filter((i) => !i.product.active || i.product.stock < i.quantity);
  return (
    <div className="container py-10">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">Your cart</h1>
      {cart.items.length === 0 ? (
        <Empty>Your cart is empty. <Link href="/" className="text-primary underline">Browse products</Link></Empty>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_340px]">
          <ul className="divide-y rounded-lg border bg-card">
            {cart.items.map((i) => (
              <li key={i.id} className="flex items-center gap-4 p-4">
                <ProductImage product={i.product} className="!w-20 rounded-md" />
                <div className="flex-1">
                  <Link href={`/products/${i.product.slug}`} className="font-medium hover:underline">{i.product.name}</Link>
                  <p className="text-sm text-muted-foreground">{formatMoney(i.product.priceMinor, brand.currency)} each</p>
                </div>
                <CartQuantity productId={i.productId} quantity={i.quantity} max={i.product.stock} />
                <p className="w-28 text-right font-medium tabular-nums">{formatMoney(i.product.priceMinor * i.quantity, brand.currency)}</p>
              </li>
            ))}
          </ul>
          <Card className="h-fit">
            <CardHeader><CardTitle>Summary</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Subtotal" value={formatMoney(cart.subtotalMinor, brand.currency)} />
              <Row label="Shipping" value={cart.shippingMinor ? formatMoney(cart.shippingMinor, brand.currency) : "Free"} />
              <div className="border-t pt-3"><Row label="Total" value={formatMoney(cart.totalMinor, brand.currency)} bold /></div>
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
