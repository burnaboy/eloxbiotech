import { getBrand } from "@/lib/settings";

export const metadata = { title: "Affiliate disclosure and earnings disclaimer" };

export default async function Earnings() {
  const b = await getBrand();
  return (
    <article className="prose-page">
      <h1>Affiliate disclosure and earnings disclaimer</h1>
      <h2>Affiliate disclosure</h2>
      <p>Members of the {b.companyName} affiliate programme may share links to our products and earn a commission when someone buys through their link. If someone shared a link with you, they may be paid if you buy. This doesn't change the price you pay.</p>
      <p>Affiliates must make this clear when they promote our products, for example by saying "I earn a commission if you buy through my link".</p>
      <h2>Earnings disclaimer</h2>
      <ul>
        <li>{b.companyName} does not promise, guarantee or forecast any level of income.</li>
        <li>What an affiliate earns depends entirely on genuine product sales to customers, and on the effort, skill and circumstances of the individual. Many participants earn little or nothing.</li>
        <li>Any examples in our materials show how the calculations work. They are not typical results or projections.</li>
        <li>You should not give up a job, borrow money or buy products in the hope of earning commissions.</li>
      </ul>
      <p>Once we have a full year of real data, we will publish an income disclosure based on actual payouts.</p>
    </article>
  );
}
