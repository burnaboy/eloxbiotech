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
      <h2 id="attribution">How sales are credited</h2>
      <ul>
        <li><strong>Your link sets the sponsor.</strong> Opening a referral link remembers that affiliate for 30 days on that browser. If the person creates an account within that time, the affiliate becomes their sponsor. Typing a referral code on the sign-up form does the same.</li>
        <li><strong>The sponsor is permanent.</strong> Every later order from that customer is credited to the same sponsor, whichever link they use afterwards. Sponsors can't be changed or transferred, and nobody can sponsor themselves.</li>
        <li><strong>Each order records who it was credited to</strong> at the moment it is placed, so later changes can't move a past sale.</li>
        <li><strong>Affiliates' own purchases</strong> count as their own personal volume. The direct commission on them goes to their sponsor, not to the buyer.</li>
        <li><strong>No sponsor, no commission.</strong> Customers who sign up without a link or code buy directly from the company.</li>
        <li><strong>Only kept sales count.</strong> Commissions and volume are confirmed after the return window. Refunded, cancelled or charged-back orders earn nothing, and anything already paid on them is deducted from future earnings.</li>
      </ul>
      <h2>What we don't do</h2>
      <ul>
        <li>No joining fees, starter kits or required purchases.</li>
        <li>No payment for recruiting. Signing people up, or filling a position in your tree, earns nothing by itself.</li>
        <li>No guaranteed income. A bigger network doesn't mean bigger earnings unless real customers buy and keep products.</li>
        <li>No pressure to buy inventory. We ship directly to customers.</li>
      </ul>
      <p>The exact rates and rules are in the <Link href="/compensation">compensation plan</Link>. Please also read the <Link href="/legal/earnings-disclaimer">earnings disclaimer</Link>.</p>
      <div className="pt-2"><Button asChild size="lg"><Link href="/register">Create a free account</Link></Button></div>
    </article>
  );
}
