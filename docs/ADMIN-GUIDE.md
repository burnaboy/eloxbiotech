# Admin guide

Day-to-day running of the shop and affiliate programme. Every admin needs two-step sign-in. Steps that move money or change the network ask for a fresh code, a written reason and sometimes a typed confirmation word; each is recorded in the audit log with your name.

## Getting access

A super admin adds you under *Admin team* with only the areas you need (Orders, Products, Members, Network, Commissions, Withdrawals, Support, Risk, Settings, Audit, Product costs). On first visit to `/admin` you set up an authenticator app and save your recovery codes. Lost your phone? Use a recovery code, or ask a super admin to reset your two-step sign-in after confirming who you are by phone.

## Daily

**Orders** (*Orders*)
1. Filter by *Paid*. Open each order, pack it, then *Mark as being prepared* and *Mark shipped* (carrier and tracking reference). *Mark delivered* when confirmed.
2. Paid orders older than 3 days not yet being prepared show as a warning on *System health*.

**Returns and refunds** (*Returns*, order page)
- Approve or reject return requests. When goods come back, *Record returned goods* (choose *Restock* or *Write off*).
- *Refund* on the order page: whole order or chosen items, with a reason. Unshipped items go back into stock automatically. The commission on refunded items is reversed automatically.
- A refund Paystack refuses shows as failed; use *Retry*. Don't refund the same order a second way (bank transfer) without recording it.

**Withdrawals** (*Withdrawals*)
1. *Review* each request: check the account name matches the member, then *Approve* or *Reject* with a reason the member will see. You can't approve your own.
2. *Create payout batch* from approved requests and *Download transfer file*. Upload it to the bank's bulk transfer.
3. When the bank confirms, *Record as paid* for each: the transfer reference, the date the transfer settled, and the settlement evidence (statement line). A reference can be used only once.
4. If a transfer bounced: *Mark failed* with the reason (funds return to the member's wallet), then *Send again* once fixed.

**Support** (*Support*): reply within 2 working days; complaints follow `/legal/complaints`.

## As needed

| Task | Where | Notes |
| --- | --- | --- |
| Add or edit products, stock, prices | *Products & stock* | Stock changes need a note. Cost prices only for admins with *Product costs* |
| Place new affiliates (if placement is by admin) | *Network* | Choose a free position under the sponsor's team. Permanent: it can't be moved later |
| Hold a suspicious commission | *Commissions* | Stops it becoming withdrawable until released; give a reason |
| Correct a wallet | Member page | Only with a documented reason (incident or ticket number); creates a correcting entry, never edits |
| Suspend a member | Member page | Signs them out everywhere |
| Change the compensation plan | *Settings* (super admin) | Publishes a new version; past sales keep the version they were paid under. Get the change approved in writing first |
| Discount codes | *Discount codes* | Limits per code and per customer |
| Stockists | *Stockists* | Members see active stockists on *Stockist location* in their dashboard, filtered by state |
| Membership packages | *Products & stock* | Put package products in the *Packages* category; members buy and upgrade from *Package upgrade* through the normal checkout |
| Rank awards | `src/lib/ranks.ts` | Ranks are worked out from active referrals and weaker-team PV; thresholds and award names are set there. Awards are handed out by staff and never move money |
| Reports and exports | *Reports*, export buttons | Exports need a fresh code and are logged. Store downloaded files securely and delete them when done |

## Weekly and monthly

- *Risk & reconciliation*: run *Check wallets* and *Check network volume*; both should report no problems. Review shared bank accounts and addresses for self-purchase rings.
- *Reports → Payout reconciliation*: compare with the bank statement.
- Monthly: *Audit log → Verify now*, write down the latest sealed hash in the finance pack; review who is on the admin team.

## Emergencies (super admin)

*Emergency operations* has switches that take effect at once: pause checkout, pause commissions, pause withdrawals, show a notice on the site, and sign everyone out. Use them first, then follow `docs/INCIDENT-RESPONSE.md`.
