import { getBrand, getShopSettings } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { currentPlanVersion, rulesOf } from "@/lib/comp-plan";
import { formatBps } from "@/lib/utils";

export const metadata = { title: "Compensation plan" };

export default async function Compensation() {
  const [version, brand, shop] = await Promise.all([currentPlanVersion(), getBrand(), getShopSettings()]);
  const plan = rulesOf(version);
  const m = (v: number) => formatMoney(v, brand.currency);
  const unit = plan.pairUnitPv;
  return (
    <article className="prose-page">
      <h1>Compensation plan</h1>
      <p>This page is generated from the plan currently in force (version {version.version}, from {version.createdAt.toLocaleDateString("en-NG", { timeZone: "Africa/Lagos" })}), so it always matches what the system pays. Each order keeps the plan version that applied when it was paid.</p>

      <h2>The basics</h2>
      <ul>
        <li>Joining as an affiliate is free. There is no starter pack, stock purchase or fee.</li>
        <li>Commissions are paid only on products that customers buy and keep. Nobody earns anything for signing someone up.</li>
        <li>Each product carries a number of points, called PV (product volume), shown to affiliates on the product page.</li>
      </ul>

      <h2>1. Direct sales commission</h2>
      <p>When a customer you referred buys products, you earn <strong>{formatBps(plan.directRateBps)}</strong> of the eligible sale: the price of commissionable products after any discount, excluding VAT and delivery. Amounts are rounded down to the kobo.</p>
      <ul>
        <li>Your own purchases never earn you a commission.</li>
        {!plan.directOnMemberPurchases && <li>Purchases by other affiliates for themselves don't earn their sponsor a commission. Commissions are for retail sales to customers.</li>}
        <li>If part of an order is refunded, the commission is recalculated on what the customer kept.</li>
      </ul>

      <h2>2. Binary team commission</h2>
      {!plan.binaryEnabled && <p><strong>Team commissions are not being paid at the moment.</strong> Volume is still tracked on each side and is kept. The rules below describe how pairing will work once it is switched on.</p>}
      <p>Every affiliate has a left and a right side in the network. {plan.binaryRetailOnly
        ? "Product volume from orders placed by customers (people who are not affiliates) on each side is added to that side. Affiliates' purchases for themselves add no volume, so team commission only ever comes from sales to customers."
        : "Product volume from purchases made by people on each side is added to that side."}</p>
      <ul>
        <li>Every <strong>{unit} PV</strong> on a side makes one unit.</li>
        <li>
          {plan.pairingRatio === "1:1"
            ? "One unit on the left matched with one unit on the right makes a pair."
            : "Two units on one side matched with one unit on the other makes a pair (either way round)."}
        </li>
        <li>Each pair pays <strong>{m(plan.pairValueMinor)}</strong>.</li>
        {plan.dailyCapMinor > 0 && <li>The most you can earn from pairs in one day is <strong>{m(plan.dailyCapMinor)}</strong>. Volume matched beyond that is used up without payment.</li>}
        <li>{plan.carryForward ? `Unmatched volume carries forward to the next day${plan.maxCarryPv > 0 ? `, up to ${plan.maxCarryPv.toLocaleString()} PV per side` : ""}.` : "Unmatched volume does not carry forward; it is cleared after each daily run."}</li>
      </ul>
      <h3>Who qualifies for team commission</h3>
      <ul>
        {plan.requireDirectOnEachLeg && <li>You must have personally referred at least one active affiliate on your left side and one on your right side.</li>}
        {plan.minPersonalPv > 0 && <li>You need at least {plan.minPersonalPv} PV of personal volume from {plan.binaryRetailOnly ? "your customers' orders" : "your own or your customers' purchases"}.</li>}
        {!plan.requireDirectOnEachLeg && plan.minPersonalPv === 0 && <li>All active affiliates qualify.</li>}
        <li>Until you qualify, your volume still builds up and is kept.</li>
      </ul>

      <h2>3. When commissions are paid</h2>
      <ol>
        <li><strong>Pending:</strong> a commission is created when the customer's payment is confirmed.</li>
        <li><strong>Held:</strong> it is frozen if the payment is disputed or under review.</li>
        <li><strong>Approved:</strong> after the {plan.holdDays}-day return window, it becomes available to withdraw. Volume enters the team calculation at the same point.</li>
        <li><strong>Reversed:</strong> if the order is refunded or charged back, the commission is cancelled, or reduced for a partial refund. If it was already withdrawn, it is deducted from future earnings.</li>
      </ol>
      <p>You can request a withdrawal once your approved balance reaches {m(shop.minPayoutMinor)}.</p>

      <h2>Illustration (not a forecast)</h2>
      <p>
        This only shows how the arithmetic works. If, over one day, product purchases on your left side total {(unit * 3).toLocaleString()} PV and on your right side {(unit * 2).toLocaleString()} PV,
        {plan.pairingRatio === "1:1"
          ? ` that makes 2 pairs (${m(plan.pairValueMinor * 2)}) and ${unit.toLocaleString()} PV carries forward on the left.`
          : " the system finds the most pairs the 2:1 rule allows and carries forward what remains."}
      </p>
      <p>Read our <a href="/legal/earnings-disclaimer">earnings disclaimer</a>. We do not promise or project any income.</p>
    </article>
  );
}
