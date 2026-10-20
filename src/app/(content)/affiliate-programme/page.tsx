import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getBrand } from "@/lib/settings";

export const metadata = { title: "Affiliate programme" };

export default async function AffiliateProgramme() {
  const b = await getBrand();
  return (
    <article className="prose-page">
      <h1>The {b.companyName} affiliate programme</h1>
      <p>Recommend products you like. When people buy through your link and keep their order, you earn a commission.</p>
      <h2>How it works</h2>
      <ol>
        <li><strong>Join for free.</strong> Create an account and tick "Join as an affiliate", or upgrade later from your dashboard.</li>
        <li><strong>Share your links.</strong> Your dashboard has a personal referral link, and every product page has a share link.</li>
        <li><strong>Earn on real sales.</strong> You earn a direct commission when your customers buy, and a team commission from product volume across your left and right sides.</li>
        <li><strong>Withdraw.</strong> Once commissions clear the return window, request a payout to your bank account.</li>
      </ol>
      <h2>What we don't do</h2>
      <ul>
        <li>No joining fees, starter kits or required purchases.</li>
        <li>No payment for recruiting. Signing people up earns nothing by itself.</li>
        <li>No pressure to buy inventory. We ship directly to customers.</li>
      </ul>
      <p>The exact rates and rules are in the <Link href="/compensation">compensation plan</Link>. Please also read the <Link href="/legal/earnings-disclaimer">earnings disclaimer</Link>.</p>
      <div className="pt-2"><Button asChild size="lg"><Link href="/register">Create a free account</Link></Button></div>
    </article>
  );
}
