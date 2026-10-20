import { getBrand } from "@/lib/settings";

export const metadata = { title: "Complaints" };

export default async function Complaints() {
  const b = await getBrand();
  return (
    <article className="prose-page">
      <h1>Complaints</h1>
      <p>If something has gone wrong with an order, a refund, a commission or the way we handled your data, we want to put it right.</p>
      <h2>How to complain</h2>
      <ul>
        <li>Signed in: open a ticket under <a href="/support">Help and support</a>. Choose the order it&apos;s about, if any.</li>
        <li>Not signed in: use the <a href="/contact">contact form</a>{b.supportEmail ? <>, or email <a href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a></> : null}{b.supportPhone ? `, or call ${b.supportPhone}` : ""}.</li>
      </ul>
      <p>Tell us what happened, when, the order number if there is one, and what you would like us to do.</p>
      <h2>What happens next</h2>
      <ol>
        <li>We acknowledge your complaint within 2 working days.</li>
        <li>A member of staff investigates. We may ask for photos or more detail.</li>
        <li>We aim to give you a full answer within 14 days. If it will take longer, we tell you why and when to expect it.</li>
        <li>If you are not happy with the answer, reply to the ticket and ask for it to be reviewed by a manager.</li>
      </ol>
      <h2>If you are still not satisfied</h2>
      <ul>
        <li>Consumer complaints: the Federal Competition and Consumer Protection Commission (FCCPC), fccpc.gov.ng.</li>
        <li>Personal data complaints: the Nigeria Data Protection Commission (NDPC), ndpc.gov.ng.</li>
        <li>Card payment disputes: your bank, which can raise a chargeback.</li>
      </ul>
      <p>Making a complaint never affects your account, your orders or any commission you have earned.</p>
    </article>
  );
}
