import { getBrand } from "@/lib/settings";

export const metadata = { title: "About us" };

export default async function About() {
  const b = await getBrand();
  return (
    <article className="prose-page">
      <h1>About {b.companyName}</h1>
      {b.about ? b.about.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>) : (
        <p>{b.companyName} sells genuine physical products across Nigeria and lets members share those products and earn commissions on completed sales.</p>
      )}
      <h2>What we stand for</h2>
      <ul>
        <li>Genuine products at clear prices, with tracked delivery.</li>
        <li>A transparent compensation plan that pays only on real product sales, never for signing people up.</li>
        <li>No joining fee and no requirement to buy stock or starter packs.</li>
        <li>Fair returns and refunds, as set out in our <a href="/legal/refunds">refund policy</a>.</li>
      </ul>
      {(b.registrationNumber || b.address) && (
        <>
          <h2>Company details</h2>
          {b.registrationNumber && <p>Registration number: {b.registrationNumber}</p>}
          {b.address && <p>Address: {b.address}</p>}
        </>
      )}
    </article>
  );
}
