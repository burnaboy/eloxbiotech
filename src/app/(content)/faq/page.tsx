import { getBrand, getCompPlan, getShopSettings } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { formatBps } from "@/lib/utils";

export const metadata = { title: "FAQ" };

export default async function Faq() {
  const [b, plan, shop] = await Promise.all([getBrand(), getCompPlan(), getShopSettings()]);
  const m = (v: number) => formatMoney(v, b.currency);
  const qa: [string, React.ReactNode][] = [
    ["How do I pay?", "Checkout uses Paystack. You can pay by card, bank transfer, USSD and the other methods Paystack offers in Nigeria. We never see or store your card details."],
    ["How long does delivery take?", shop.deliveryInfo],
    ["How much is delivery?", shop.freeShippingOverMinor > 0 ? `${m(shop.flatShippingMinor)} per order, free on orders over ${m(shop.freeShippingOverMinor)}.` : `${m(shop.flatShippingMinor)} per order.`],
    ["Can I return a product?", <>Yes. You can request a return within {shop.returnWindowDays} days of delivery from your order page. See the <a href="/legal/refunds">refund policy</a>.</>],
    ["Do I have to buy anything to become an affiliate?", "No. Joining is free and there's no purchase requirement."],
    ["How do affiliates earn?", <>Only from completed product sales: a {formatBps(plan.directRateBps)} direct commission on retail sales to customers{plan.binaryEnabled ? " and a team commission based on product volume" : ""}. Details are in the <a href="/compensation">compensation plan</a>.</>],
    ["When are commissions paid?", `Commissions are approved ${plan.holdDays} days after payment (after the return window). You can withdraw once your approved balance reaches ${m(shop.minPayoutMinor)}.`],
    ["What happens if a customer gets a refund?", "The commission on that order is reversed, or reduced if only part of the order is refunded. If it was already withdrawn, it is deducted from future earnings."],
    ["How is my data protected?", <>We process personal data in line with the Nigeria Data Protection Act 2023. See our <a href="/legal/privacy">privacy policy</a>.</>],
  ];
  return (
    <article className="prose-page">
      <h1>Frequently asked questions</h1>
      <div className="divide-y rounded-lg border bg-card">
        {qa.map(([q, a]) => (
          <details key={q} className="group p-4">
            <summary className="cursor-pointer list-none font-medium">{q}</summary>
            <div className="pt-2 text-muted-foreground">{a}</div>
          </details>
        ))}
      </div>
    </article>
  );
}
