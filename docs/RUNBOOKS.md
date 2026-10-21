# Operational runbooks

Step-by-step procedures for recurring operational work. Incidents (outages, breaches, wrong payments) are in `INCIDENT-RESPONSE.md`; releases and rollback in `DEPLOYMENT.md`; day-to-day admin screens in `ADMIN-GUIDE.md`.

## 1. Payment reconciliation

Three automatic checks, plus a weekly look by finance.

| Check | When | What it compares |
| --- | --- | --- |
| `reconcile-payments` job | every 10 minutes | Payments still pending after a few minutes are re-verified with Paystack and recorded (catches lost webhooks) |
| `reconcile-gateway` job | daily 03:00 | Paystack's successful transactions for the last two days against payments recorded here, both ways. Result on *System health → Paystack reconciliation*; a mismatch raises an alert |
| `reconcile-ledger` job | daily 02:00 | The wallet ledger against commissions and withdrawals |

**When *Paystack reconciliation* shows problems** (details in *Audit log*, action `gateway.reconcile`):

| Kind | Meaning | Do |
| --- | --- | --- |
| `not_paid_at_gateway` | Recorded as paid here, but Paystack has no successful transaction. **Most serious** | Pause commissions. Look the reference up in the Paystack dashboard. If Paystack really has no payment, cancel the order (don't ship) and open an incident (forged or mis-recorded payment) |
| `amount_mismatch` | Paid at Paystack with a different amount or currency | The app normally refuses these, so treat as an incident. Compare in Paystack; refund the difference or the payment, and record a correction |
| `not_recorded_paid` | Paid at Paystack, still pending or failed here | Usually a webhook that never arrived. Wait for the next `reconcile-payments` run; if still wrong, open the order and check. Paid after the order expired? It shows on *Risk & reconciliation → Payment issues*; refund it with *Give back extra payment* |
| `unknown_here` | Paid at Paystack with a reference this app didn't create | Payment made outside the shop (payment link, another app on the same account). Check with finance; keep the shop's Paystack account for the shop only |

**Weekly (finance):** *Reports → Revenue* for the week against the Paystack settlement report (amount settled to the bank equals Paystack transactions minus fees and refunds); *Reports → Payout reconciliation* against the bank statement (every paid withdrawal has a matching debit with the same reference). Record the result in the finance pack.

## 2. Withdrawals (no real money moves without a person)

The app never sends money. Finance pays through the bank's bulk transfer and records each payment with evidence. Before the first real payout: go-live approval (`HOSTING.md`, go-live checklist) and a test batch on staging. For each batch, two people: one prepares and uploads the transfer file at the bank, a second approves it in the bank portal. Steps are in `ADMIN-GUIDE.md`, *Withdrawals*.

## 3. Dependency updates

| When | What |
| --- | --- |
| Weekly (automated or a 10-minute look) | `npm audit --omit=dev`: advisories in packages that ship to production. High or critical with a fix: patch within 7 days; follow the steps below |
| Monthly | `npm outdated`; take patch and minor updates together in one branch |
| Quarterly | Plan major upgrades (Next.js, Prisma, React, Tailwind) one at a time, each on its own branch |
| Immediately | A critical advisory that is reachable from the internet (Next.js, React, auth or payment code): same day, as an emergency release |

Steps for any update:
1. New branch. `npm update <pkg>` or `npm install <pkg>@<version>`; commit `package.json` and `package-lock.json` together.
2. Read the package's changelog for breaking changes, especially Next.js, Prisma (migration engine) and `otpauth`/`@node-rs/argon2` (sign-in).
3. `scripts/release-check.sh` must pass (CI runs it). A Prisma upgrade also needs `npx prisma migrate diff` showing no change.
4. Deploy to staging, run the go-live checklist steps 2–4 (buy, decline, refund) with test cards.
5. Release to production as usual (`DEPLOYMENT.md`). If anything breaks, roll back to the previous build: dependency updates never include migrations.

Known open items (`SECURITY.md`): Next.js 16, Prisma 7 and Tailwind 4 upgrades clear the remaining build-tool advisories. None of them is reachable from a request.

## 4. Database migrations

- Every migration is reviewed in the pull request. Adding things is routine; anything that drops, empties, deletes, renames, rewrites rows or changes a column type is **blocked automatically** (`scripts/check-migrations.ts` runs in CI and before every deploy) unless the file has a line `-- approved-destructive: <name>, <date>, <reason>` from the business owner.
- Destructive changes follow the two-release pattern in `DEPLOYMENT.md`, with a fresh backup taken just before.
- Never run SQL by hand against production except through a reviewed migration or the restore procedure.

## 5. Backups and restore tests

| What | How | Check |
| --- | --- | --- |
| Continuous | Render point-in-time recovery (3 or 7 days) | Quarterly restore drill |
| Daily copy elsewhere | A scheduled `pg_dump` to the image bucket's separate backup bucket (encrypted), kept 35 days, monthly kept 12 months. Set up with the hosting account; until then, take a manual export weekly from the database's *Recovery* page | Monthly: restore the latest into a scratch database and run `scripts/verify-restore.ts` |
| Before every release | On-demand export (*Recovery → Create export*) | — |

Restore test (monthly, 30 minutes): create a scratch database, `pg_restore --no-owner --dbname=<scratch> <dump>`, then `DATABASE_URL=<scratch> npx tsx scripts/verify-restore.ts`. All checks must pass (migrations, audit chain, wallet ledger, network volume). Record the date, time taken and result; delete the scratch database. The full procedure for a real restore is in `INCIDENT-RESPONSE.md`.

## 6. Secrets rotation

| Secret | Rotate | How |
| --- | --- | --- |
| `PAYSTACK_SECRET_KEY` | Yearly, when someone with access leaves, or on suspicion | Generate a new key in Paystack, update Render, redeploy, then revoke the old key |
| `CRON_SECRET`, `MONITOR_TOKEN` | Yearly, or on suspicion | New random value in Render (web service); the scheduler reads it from there. Update the monitor's header |
| S3 keys | Yearly | Create a new key scoped to the bucket, update Render, redeploy, delete the old key |
| Database password | When someone with access leaves | Change it in the Render database settings; services pick up the new connection string on redeploy. Check health afterwards |
| `APP_ENCRYPTION_KEY` | Only if exposed | Needs a re-encryption script (open item in `SECURITY.md`); plan with the technical lead |
| Admin accounts | On every departure, same day | *Admin team → Remove*; their sessions end immediately |

## 7. Monthly operations review (30 minutes)

System health history and alerts in the month; restore test result; dependency report; admin team list; withdrawals paid versus bank; any incidents and their follow-ups. Notes go in the finance pack.
