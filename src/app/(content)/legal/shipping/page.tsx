import { getBrand, getShopSettings } from "@/lib/settings";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Shipping and delivery" };

export default async function Shipping() {
  const [b, s] = await Promise.all([getBrand(), getShopSettings()]);
  return (
    <article className="prose-page">
      <h1>Shipping and delivery policy</h1>
      <p>{s.deliveryInfo}</p>
      <ul>
        <li>Delivery costs {formatMoney(s.flatShippingMinor, b.currency)} per order{s.perKgShippingMinor > 0 ? `, plus ${formatMoney(s.perKgShippingMinor, b.currency)} for each started kilogram` : ""}{s.freeShippingOverMinor > 0 ? `, and is free on orders over ${formatMoney(s.freeShippingOverMinor, b.currency)}` : ""}. The exact amount is shown at checkout before you pay.</li>
        {s.taxEnabled && <li>Prices {s.pricesIncludeTax ? "include" : "exclude"} {s.taxLabel}{s.taxShipping ? ", and delivery is subject to it" : ""}. Your receipt shows the {s.taxLabel} charged.</li>}
        <li>We ship once payment is confirmed. You'll get a notification with the carrier and tracking reference when your order ships.</li>
        <li>Please check your delivery address carefully at checkout. Contact us quickly if it needs to change.</li>
        <li>If a parcel arrives damaged, take photos and request a return from your order page.</li>
        <li>If your order is lost or badly delayed, contact us and we will trace it, resend it or refund you. See <a href="/legal/refunds">returns and refunds</a> and <a href="/legal/complaints">complaints</a>.</li>
      </ul>
    </article>
  );
}
