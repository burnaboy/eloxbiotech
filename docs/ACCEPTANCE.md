# Release acceptance criteria

Each criterion from the specification, and the automated check that proves it. Run them all with `scripts/release-check.sh` (unit and integration tests, migrations from scratch, production build, secret scan, browser tests against the production build, log scan, backup and restore). The release is not ready unless every check passes.

Files: `tests/*.test.ts` run with Vitest against a real PostgreSQL database; `e2e/*.spec.ts` run with Playwright against the production build.

## Authentication

| Criterion | Proven by |
| --- | --- |
| A new user can register | `acceptance.test.ts` › registers a new member with a hashed password…; `e2e/02-purchase` › referred customer registers, verifies email, buys… |
| Duplicate emails are rejected | `acceptance.test.ts` › …refuses the same email in any letter case; `flow.test.ts` › rejects duplicate emails and invalid referral codes |
| Unauthenticated users can't reach private dashboards | `e2e/01-storefront` › protected pages send guests to sign in (cart, checkout, dashboard, admin, account); `e2e/04-access` › guests…can't use admin pages, exports or admin actions |
| Ordinary members can't reach admin endpoints | `e2e/04-access` › a customer and an affiliate open admin pages, CSV exports, and call **every** admin server action directly; all refused and the database is unchanged (checked to fail when the admin check is deliberately broken). `acceptance.test.ts` › every admin action checks the admin's role and permission before doing anything |

## Binary network

| Criterion | Proven by |
| --- | --- |
| Every non-root member has valid placement information | `acceptance.test.ts` › keeps valid placement for every member through mixed and simultaneous sign-ups (parent exists, depth and ancestry match the parent, one member per slot, one root, every affiliate placed). The database checks each new position's path on insert |
| A parent can't have two children on the same leg | `acceptance.test.ts` › the database refuses a second child on a leg…; `flow.test.ts` › never puts two members in the same slot under concurrent sign-ups |
| Cycles are rejected | `acceptance.test.ts` › the database refuses…a cycle, a path that disagrees with the parent, and a second root |
| Self-sponsorship is rejected | `network.test.ts` › rejects self-sponsorship (application and database) |
| Unauthorized placement changes are rejected | `network.test.ts` › makes placements and sponsors permanent at the database level; › blocks admin placement into a taken slot, outside the sponsor's downline, or twice; `e2e/04-access` (members calling the placement action) |

## E-commerce

| Criterion | Proven by |
| --- | --- |
| No purchase beyond available stock | `acceptance.test.ts` › rejects invalid quantities and anything beyond available stock; `catalog.test.ts` › requires an option…and reserves that option's stock |
| The server calculates the correct order total | `acceptance.test.ts` › works out the order total on the server from database prices; `catalog.test.ts` › charges the price in the database at checkout…; `money.test.ts` › works out VAT…and the commissionable base… |
| Invalid quantities and prices are rejected | `acceptance.test.ts` › rejects invalid quantities…; › rejects invalid prices in the product form and in the database |
| Concurrent checkouts can't oversell | `catalog.test.ts` › never oversells the last unit, even with simultaneous checkouts; `flow.test.ts` › reserves stock, and never oversells under concurrent checkouts |

## Payments

| Criterion | Proven by |
| --- | --- |
| Valid Paystack transactions are verified | `paystack.test.ts` › re-verifies charge.success instead of trusting the body; `money.test.ts` › retries verification on gateway errors and checks the reference |
| Invalid signatures are rejected | `paystack.test.ts` › accepts only bodies signed with the secret key (HMAC SHA-512); `flow.test.ts` › rejects forged webhooks and ignores replays; `e2e/04-access` › forged webhook gets 401 |
| Amount and currency mismatches are rejected | `flow.test.ts` › refuses to mark an order paid when the amount doesn't match; `money.test.ts` › rejects a wrong currency… |
| Repeated webhooks don't duplicate orders or commissions | `money.test.ts` › is idempotent across webhook, callback and reconciliation…; `acceptance.test.ts` › processing the same sale many times at once creates one commission and one ledger posting |
| Failed transactions create no commissionable sales | `acceptance.test.ts` › a failed transaction creates no sale, commission, volume or wallet entry |
| Refunds and chargebacks trigger the required state changes | `flow.test.ts` › refund inside the hold window means no commission; › refund after commissions claws back…; › an open dispute blocks commissions until it is won; › a lost chargeback after commissions reverses them; › a refund made in the gateway dashboard is recorded once; `money.test.ts` › partial refunds (4 tests) |

## Commissions

| Criterion | Proven by |
| --- | --- |
| Amounts are correct | `money.test.ts` › rounds down to the kobo with integer maths only; `flow.test.ts` › credits direct bonus and leg volume only after the hold period; `binary.test.ts` (6 pairing tests, 2:1 checked against brute force); `e2e/02-purchase` (₦2,250 on a ₦22,500 order) |
| Recruitment alone generates zero commissions | `network.test.ts` › pays nothing for registering, recruiting or filling a position |
| Only eligible verified sales generate commissions | `money.test.ts` › pays on retail customer sales only…; › retail-only team volume; `acceptance.test.ts` › a failed transaction creates no sale… |
| Duplicate processing creates no duplicate entries | `acceptance.test.ts` › processing the same sale many times at once…; › overlapping runs of the scheduled jobs don't double up; `money.test.ts` › ignores a repeated idempotency key |
| Refunds create reversals | `acceptance.test.ts` › a refund after the commission was credited posts a reversal rather than editing history; `flow.test.ts` › refund after commissions claws back… |
| Rate changes don't rewrite historical calculations | `money.test.ts` › keeps the plan version of the sale when the rate changes later |

## Wallet and payouts

| Criterion | Proven by |
| --- | --- |
| Withdrawals can't exceed available balances | `flow.test.ts` › never lets concurrent requests exceed the balance… |
| Concurrent requests can't spend the same funds twice | same test, plus `money.test.ts` › …a request key makes one payout |
| Failed payouts don't permanently consume funds | `money.test.ts` › recovers a failed transfer: funds go back, then can be sent again; › …a rejection returns the funds |
| Completed payouts are reconciled to provider evidence | `acceptance.test.ts` › a payout is complete only with provider evidence, and reconciles to it; `money.test.ts` › refuses a transfer reference already used…; `admin.test.ts` › revenue, attribution and payout reconciliation add up |
| Every privileged adjustment has an audit record | `acceptance.test.ts` › records an audit entry with the acting admin for every privileged adjustment (wallet correction, commission hold and release, payout approval, batch, failure, refund, plan change, two-step reset, stock); `money.test.ts` › seals records into a hash chain and detects tampering |

## Operations

| Criterion | Proven by (`scripts/release-check.sh` step) |
| --- | --- |
| Production builds succeed | 3: `next build` |
| Database migrations are reproducible | 2: all migrations applied to two empty databases give identical schemas (constraints and triggers included), and match `schema.prisma` with no drift |
| Secrets are absent from frontend bundles | 3: the build runs with throwaway "canary" secret values; every browser file is searched for them, for key patterns (`sk_live_`, `sk_test_…`, `postgres://`, private keys), secret variable names, and server-only fields (password hashes, cost prices, encrypted bank numbers) |
| Logs don't expose sensitive credentials | 5: the server log from the full browser run is searched for the test passwords, the secrets and encryption key it ran with, database credentials, bearer tokens and live session ids. `admin.test.ts` › scrubs secrets and personal data from logged errors |
| Backup restoration is tested | 6: `pg_dump` of the browser-test database, restored into a new database; row counts match table by table, and the audit chain, wallet ledger and network volume checks pass on the restored copy (`scripts/verify-restore.ts`) |
| Deployment and rollback instructions are documented | `docs/DEPLOYMENT.md`; restore procedure in `docs/INCIDENT-RESPONSE.md` |

## Not covered by automated tests

These need people or real services and are on the launch checklist instead:

- Live Paystack: one real low-value purchase and refund after go-live (`docs/DEPLOYMENT.md`, first deploy step 9). All automated payment tests use the built-in test gateway or recorded Paystack responses.
- Real email delivery: no email provider is connected yet; emails are queued but not sent.
- Restore of a production-sized database, and PITR restore on the managed host: rehearse in the quarterly drill.
- Browsers other than Chromium, and screen-reader checks.
