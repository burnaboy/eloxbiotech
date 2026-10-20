import { getShopSettings } from "@/lib/settings";

export const metadata = { title: "Returns and refunds" };

export default async function Refunds() {
  const s = await getShopSettings();
  return (
    <article className="prose-page">
      <h1>Returns and refund policy</h1>
      <ul>
        <li>You can request a return within <strong>{s.returnWindowDays} days</strong> of delivery from your order page.</li>
        <li>Items should be unused and in their original packaging, unless they arrived faulty or damaged.</li>
        <li>We review each request and reply with return instructions. Faulty or wrong items are returned at our cost.</li>
        <li>Approved refunds go back to the original payment method through Paystack. Your bank may take a few working days to show it.</li>
        <li>Unpaid orders can be cancelled at any time from the order page.</li>
      </ul>
      <p>Refunding an order also reverses any affiliate commission earned on it.</p>
    </article>
  );
}
