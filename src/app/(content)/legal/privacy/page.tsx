import { getBrand } from "@/lib/settings";
import { COOLING_OFF_HOURS } from "@/lib/payouts/accounts";

export const metadata = { title: "Privacy policy" };

export default async function Privacy() {
  const b = await getBrand();
  return (
    <article className="prose-page">
      <h1>Privacy policy</h1>
      <p>
        {b.companyName}{b.registrationNumber ? ` (CAC ${b.registrationNumber})` : ""}{b.address ? `, ${b.address}` : ""} is the data controller for the personal data
        described here. We process it in line with the Nigeria Data Protection Act 2023 (NDPA). Questions or requests: {b.supportEmail ? <a href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a> : <a href="/contact">contact us</a>}.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>Account details: name, email, phone, password (stored only as a secure hash).</li>
        <li>Delivery addresses and order history.</li>
        <li>Payment references from Paystack. We never receive or store your full card details.</li>
        <li>For affiliates: your sponsor, network placement, sales volume, commissions, withdrawals, and the bank account you give for payouts (account number stored encrypted). We do not collect your BVN.</li>
        <li>Security data: sign-in times, IP address and device information, used to protect accounts and prevent fraud.</li>
        <li>Messages you send to support.</li>
      </ul>

      <h2>Why we use it, and our lawful basis</h2>
      <ul>
        <li><strong>To perform our contract with you:</strong> taking orders and payment, delivery, returns, support, running the affiliate programme and paying commissions.</li>
        <li><strong>Legal obligations:</strong> tax, accounting and anti-fraud records.</li>
        <li><strong>Legitimate interests:</strong> keeping accounts secure, preventing fraud and abuse of the affiliate programme, improving the shop.</li>
        <li><strong>Consent:</strong> optional marketing emails, which you can turn off at any time in your account.</li>
      </ul>

      <h2>Who we share it with</h2>
      <ul>
        <li>Paystack, to take payments and refunds.</li>
        <li>Delivery partners, to ship your orders (name, phone, address).</li>
        <li>Our bank, to send affiliate payouts (name, account number, amount).</li>
        <li>Hosting, storage and email providers that process data for us under contract.</li>
        <li>Authorities, where the law requires it.</li>
      </ul>
      <p>Some of these providers may store data outside Nigeria. Where they do, we rely on the safeguards the NDPA requires, such as contractual protections.</p>
      <p>Your sponsor and upline can see your name, referral code, network position and volume, but not your email, phone, address or earnings. Buyer names shown to affiliates are shortened.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Orders, payments, refunds, commissions and payouts: 6 years after the transaction, for tax and accounting.</li>
        <li>Account details: while your account is open, then up to 2 years unless needed for the records above.</li>
        <li>Security logs and sign-in attempts: up to 1 year (failed sign-ins: 30 days).</li>
        <li>Support messages: 3 years.</li>
      </ul>

      <h2>How we protect it</h2>
      <p>Encrypted connections, hashed passwords, encrypted bank details, two-step verification for staff, access limited by role, and a tamper-evident audit log of staff actions. New or changed payout accounts can only be used after {COOLING_OFF_HOURS} hours, and we email you when they change.</p>

      <h2>Your rights</h2>
      <p>You can ask to access, correct or delete your data, to restrict or object to processing, to withdraw consent, or to receive your data in a portable format. Contact us as above; we reply within 30 days. Some records must be kept by law even if you close your account. You can also complain to the Nigeria Data Protection Commission (ndpc.gov.ng). See <a href="/legal/complaints">complaints</a>.</p>

      <h2>Cookies</h2>
      <p>We use essential cookies only, and no advertising or tracking cookies:</p>
      <ul>
        <li>Session: keeps you signed in (up to 14 days).</li>
        <li>Referral: remembers who referred you (30 days).</li>
        <li>Discount code: remembers a code you applied to your cart (7 days).</li>
      </ul>

      <h2>Children</h2>
      <p>Accounts are for people aged 18 and over.</p>
    </article>
  );
}
