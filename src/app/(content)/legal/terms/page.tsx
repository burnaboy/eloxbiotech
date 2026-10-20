import { getBrand, getCompPlan } from "@/lib/settings";

export const metadata = { title: "Terms and conditions" };

export default async function Terms() {
  const [b, plan] = await Promise.all([getBrand(), getCompPlan()]);
  return (
    <article className="prose-page">
      <h1>Terms and conditions</h1>
      <p>These terms govern your use of the {b.companyName} website, purchases you make, and, if you join, the affiliate programme. By creating an account you agree to them.</p>
      <h2>1. Accounts</h2>
      <ul><li>You must be 18 or older and give accurate information.</li><li>Keep your password and authentication codes private. You are responsible for activity on your account.</li><li>One account per person. Duplicate or fake accounts may be closed and any commissions reversed.</li></ul>
      <h2>2. Orders and payment</h2>
      <ul><li>Prices are shown in {b.currency} and include applicable taxes unless stated otherwise.</li><li>An order is confirmed when Paystack confirms payment. Unpaid orders are cancelled automatically.</li><li>We may cancel and refund an order if a product is unavailable or a pricing error occurred.</li></ul>
      <h2>3. Delivery, returns and refunds</h2>
      <p>See the <a href="/legal/shipping">shipping policy</a> and <a href="/legal/refunds">returns and refund policy</a>.</p>
      <h2>4. Affiliate programme</h2>
      <ul>
        <li>Participation is free and voluntary. No purchase is required to join or to earn.</li>
        <li>Commissions are earned only on eligible, completed product sales, as described in the <a href="/compensation">compensation plan</a>. No compensation is paid for recruiting.</li>
        <li>Commissions are held for {plan.holdDays} days and are reversed if the related order is refunded or charged back.</li>
        <li>You must not make false or exaggerated claims about products or income, use spam, bid on our brand name in ads, or buy products solely to qualify for commissions.</li>
        <li>You must not create accounts for other people, manipulate placement, or place orders with stolen payment details. We may hold or reverse commissions while we investigate suspected abuse, and close accounts that break these terms.</li>
        <li>You are responsible for your own taxes on commissions.</li>
      </ul>
      <h2>5. Changes</h2>
      <p>We may update these terms or the compensation plan. Changes apply from the date published and never take away commissions already approved.</p>
      <h2>6. Contact</h2>
      <p>Questions? <a href="/contact">Contact us</a>.</p>
    </article>
  );
}
