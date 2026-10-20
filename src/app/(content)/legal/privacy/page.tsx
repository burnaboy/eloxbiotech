import { getBrand } from "@/lib/settings";

export const metadata = { title: "Privacy policy" };

export default async function Privacy() {
  const b = await getBrand();
  return (
    <article className="prose-page">
      <h1>Privacy policy</h1>
      <p>{b.companyName} processes personal data in line with the Nigeria Data Protection Act 2023 (NDPA).</p>
      <h2>What we collect</h2>
      <ul>
        <li>Account details: name, email, phone, password (stored only as a secure hash).</li>
        <li>Delivery addresses and order history.</li>
        <li>Payment references from Paystack. We never receive or store your full card details.</li>
        <li>For affiliates: your sponsor, network placement, sales volume, commissions and the payout account details you provide.</li>
        <li>Security data: sign-in times, IP address and device information, used to protect accounts and prevent fraud.</li>
      </ul>
      <h2>Why we use it</h2>
      <ul><li>To process and deliver orders, handle returns and provide support.</li><li>To run the affiliate programme and pay commissions.</li><li>To keep the platform secure and meet legal, tax and accounting duties.</li></ul>
      <h2>Who we share it with</h2>
      <ul><li>Paystack, to take payments.</li><li>Delivery partners, to ship your orders.</li><li>Hosting and email providers that process data on our behalf.</li><li>Authorities, where the law requires it.</li></ul>
      <p>Your sponsor and upline can see your name and network position, but not your email, phone or address.</p>
      <h2>Your rights</h2>
      <p>You can ask to access, correct or delete your data, or object to processing, by <a href="/contact">contacting us</a>. We keep financial records for as long as the law requires.</p>
      <h2>Cookies</h2>
      <p>We use essential cookies only: one to keep you signed in, and one to remember who referred you, for 30 days.</p>
    </article>
  );
}
