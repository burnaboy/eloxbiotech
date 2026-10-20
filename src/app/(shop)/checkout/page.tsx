import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getCart } from "@/lib/orders";
import { getBrand } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckoutForm } from "./checkout-form";

export const metadata = { title: "Checkout" };

export default async function CheckoutPage() {
  const user = await requireUser("/checkout");
  const [cart, brand, last, saved] = await Promise.all([
    getCart(user.id),
    getBrand(),
    prisma.order.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
    prisma.address.findFirst({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
  ]);
  if (!cart.items.length) redirect("/cart");
  if (!user.emailVerifiedAt) redirect("/account?error=Please%20confirm%20your%20email%20address%20before%20checking%20out.");
  const defaults = saved
    ? { shipName: saved.name, shipPhone: saved.phone, shipLine1: saved.line1, shipLine2: saved.line2 ?? "", shipCity: saved.city, shipState: saved.state, shipCountry: saved.country, shipPostal: saved.postal ?? "" }
    : last
    ? { shipName: last.shipName, shipPhone: last.shipPhone, shipLine1: last.shipLine1, shipLine2: last.shipLine2 ?? "", shipCity: last.shipCity, shipState: last.shipState, shipCountry: last.shipCountry, shipPostal: last.shipPostal ?? "" }
    : { shipName: user.name, shipPhone: user.phone ?? "" };
  return (
    <div className="container grid gap-8 py-10 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader><CardTitle>Delivery details</CardTitle></CardHeader>
        <CardContent><CheckoutForm defaults={defaults} /></CardContent>
      </Card>
      <Card className="h-fit">
        <CardHeader><CardTitle>Order summary</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {cart.items.map((i) => (
            <div key={i.id} className="flex justify-between gap-2">
              <span>{i.product.name} × {i.quantity}</span>
              <span className="tabular-nums">{formatMoney(i.product.priceMinor * i.quantity, brand.currency)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-2"><span>Shipping</span><span>{cart.shippingMinor ? formatMoney(cart.shippingMinor, brand.currency) : "Free"}</span></div>
          <div className="flex justify-between text-base font-semibold"><span>Total</span><span>{formatMoney(cart.totalMinor, brand.currency)}</span></div>
        </CardContent>
      </Card>
    </div>
  );
}
