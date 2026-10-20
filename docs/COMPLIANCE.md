# Legal and compliance review

**This is an engineering review, not legal advice.** Before launch, a qualified Nigerian lawyer must review the business model, the compensation plan and the policies below. The checklist at the end lists what to ask them.

## The principle the platform is built on

Every naira paid to an affiliate must trace back to a product sold to a real customer and not refunded. Joining, recruiting, holding a position in the tree or buying for yourself earns nothing.

## How each safeguard is met

| Requirement | How the platform meets it | Where |
| --- | --- | --- |
| No earnings from recruitment | Commission is created only when a verified payment for products arrives. There is no sign-up fee, no bonus for enrolling anyone, and placement adds no volume. | `src/lib/commissions.ts` (`onOrderPaid`) |
| Genuine retail sales | Direct commission only on orders by customers (not affiliates buying for themselves, unless an admin switches that on). Team (binary) volume only from customer orders by default (`binaryRetailOnly`). | `directIneligibility`, `volumeNodeFor` in `src/lib/orders.ts` |
| No promised or guaranteed income | Earnings disclaimer, plan page says "not a forecast", no income figures in marketing pages, no fake dashboard data. Affiliates are told not to make income claims (terms). | `/legal/earnings-disclaimer`, `/compensation`, `/legal/terms` |
| No recurring fees without authorisation | The platform has no subscriptions, membership fees or stored-card charges. Payments are one-off checkouts the customer starts. | — |
| No forced inventory purchases | Joining is free with no starter pack. No purchase is required to stay active. Qualification for team pay (if any) is from customers' orders, not own purchases. "Personal referral on each side" is off by default. | `src/lib/settings.ts` defaults |
| Refunds reverse commissions | Full and partial refunds and chargebacks recalculate or reverse the commission and volume, even after withdrawal (deducted from future earnings). Commissions wait out a return window before they can be withdrawn. | `src/lib/refunds.ts`, `adjustOrderCommissions` |
| Clear compensation disclosure | The plan page is generated from the plan version in force, so it always matches what the system pays. Every plan change is a new, permanent version with a note of who approved it. | `/compensation`, `src/lib/comp-plan.ts` |
| Refund terms | Returns and refunds policy, linked at checkout and in the footer. | `/legal/refunds` |
| Privacy notice (NDPA 2023) | Controller identity, data collected, lawful bases, sharing, transfers abroad, retention, security, rights, NDPC complaint route, cookies. | `/legal/privacy` |
| Shipping policy | Fees generated from the shop settings, VAT treatment, damaged and lost parcels. | `/legal/shipping` |
| Complaint handling | Complaints page with timelines (acknowledge in 2 working days, answer in 14 days), manager review, escalation to FCCPC and NDPC. Support tickets track each complaint. | `/legal/complaints`, `/support` |
| Consumer protection (FCCPA 2018) | Clear prices including delivery and VAT before payment; receipts; refund route; terms say nothing limits statutory rights. | checkout, receipts, `/legal/terms` |
| Tax | VAT can be switched on (7.5%) once VAT-registered; shown on receipts. Affiliates are told they're responsible for tax on commissions. | Settings → Tax and withdrawals |
| Payments | Paystack only; the platform never sees card details. Test keys only outside production. | `src/lib/payments` |
| Affiliate disclosure | Affiliates must disclose that they earn commission when promoting. | `/legal/earnings-disclaimer` |

## Concerns in the proposed plan, and the alternative used

The original binary plan, as placeholder settings, had features regulators and courts treat as signs of a pyramid scheme. They are now off or changed by default; binary pay itself stays switched off until approved.

1. **Team volume from members' own purchases.** If affiliates' own buying counts toward their upline's binary pay, people can earn from a downline that buys rather than sells. *Alternative (now the default):* only customer orders build team volume.
2. **Recruiting as a condition of pay** ("one personal referral on each side to qualify"). This ties earnings to recruitment. *Alternative (now the default):* off; qualification can instead require a level of personal volume, which comes only from the affiliate's customers' orders.
3. **Binary pay on deep downlines** rewards network size. Keep caps (daily cap is set), and consider limiting team pay to a few levels or replacing it with a retail-based team bonus (for example, a small override on customer sales by affiliates you personally introduced, a fixed number of levels deep).
4. **Self-purchase loops** (an affiliate's spouse or second account buying through the link). Mitigations: one account per person in the terms, shared bank-account and address flags on the risk page, and admins can hold commissions.

## Policies that need operational follow-through

- **Retention periods** in the privacy notice are commitments: the cleanup job removes expired sessions and old sign-in attempts, but deleting closed accounts after 2 years is a manual process for now.
- **Data subject requests** (access, deletion) are handled through support; record each one and answer within 30 days.
- **Income disclosure**: publish one based on real payouts after the first full year (the earnings disclaimer says so).
- **Breach notification**: 72 hours to the NDPC; see `docs/INCIDENT-RESPONSE.md`.

## Checklist for the Nigerian lawyer

1. Is the business model and the compensation plan lawful as designed, under the Investments and Securities Act 2025 provisions on Ponzi and pyramid schemes, the FCCPA 2018 and any guidance from the SEC or FCCPC on direct selling and multi-level marketing?
2. Should binary team pay be launched at all, and if so with which limits (retail-only volume, caps, depth)? Or should the plan be direct retail commission plus a limited, retail-based override?
3. Does the company need to register with or notify any regulator for a direct-selling or affiliate programme?
4. NDPA: is the company a "data controller or processor of major importance" that must register with the NDPC? Is a Data Protection Officer required? Is a data protection impact assessment needed for the affiliate tree and payouts?
5. Are the privacy notice, terms, refund, shipping and complaints policies adequate and enforceable?
6. Tax: VAT registration threshold and timing; whether the company must withhold tax on commission payments to affiliates; what to report to FIRS.
7. Payouts: is paying affiliates by bulk bank transfer from the company account acceptable, or does any CBN rule apply? What records must be kept?
8. Affiliates' status: independent contractors, not employees? Any consumer-protection duties on what affiliates say?
9. Electronic transactions: are click-through acceptance of terms and electronic receipts sufficient under the Evidence Act and Cybercrimes Act?
10. Product rules: NAFDAC registration for any food, supplements, cosmetics or health products sold.
