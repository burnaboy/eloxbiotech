# Architecture

One Next.js application (pages, server actions and a few API routes) in front of one PostgreSQL database. There is no separate backend service and no message queue: work that must happen later is either a row the scheduled jobs pick up, or a state the next job run moves forward.

```
Browser ──HTTPS──▶ Next.js (stateless, 2+ instances)
                     │  pages + server actions ── src/lib (business rules)
                     │  /api/webhooks/paystack ◀── Paystack
                     │  /api/cron/<job>        ◀── scheduler (Bearer CRON_SECRET)
                     │  /api/health, /api/health/status ◀── load balancer, monitor
                     ├──▶ PostgreSQL 16 (all state; rules enforced in SQL too)
                     ├──▶ Paystack API (verify, refund, bank lookup)
                     ├──▶ S3-compatible storage (product images)
                     └──▶ email provider (from the EmailOutbox queue)
```

## Layers

| Layer | Where | Rule |
| --- | --- | --- |
| Pages | `src/app/**/page.tsx` | Read-only. Server components that call `src/lib` and check access first (`requireUser`, `requireAffiliate`, `requireAdmin`) |
| Actions | `src/app/**/actions.ts` | Every change goes through a server action: check access, rate limit, validate input with zod, call `src/lib`, redirect with a message. Admin actions use `act()` (permission, fresh two-step code, reason and typed confirmation for high-risk steps, audit) |
| Business rules | `src/lib` | All logic, inside database transactions. Never trusts prices, totals, amounts or ids from the browser |
| Database | `prisma/migrations` | Last line of defence: unique keys, CHECK constraints and triggers that make the ledger, audit log, plan versions and tree placements permanent |

## Money flow

```
Cart ─▶ Order (PENDING_PAYMENT, stock reserved, prices from the database)
  │
  ├─ payment fails / expires ─▶ CANCELLED, stock returned, nothing else happens
  ▼
Paystack confirms ─▶ re-verified with Paystack, amount + currency checked ─▶ Order PAID
  │                  (webhook, browser callback and reconcile job all end here, once)
  ▼
Commission PENDING (direct, on the referring affiliate) ── ledger: EARNED → PENDING bucket
Volume PENDING on the tree
  │
  ├─ refund / chargeback inside the return window ─▶ commission and volume cancelled
  ▼  (after holdDays; `mature-orders` job)
Commission APPROVED ── ledger: PENDING → AVAILABLE;  volume credited up both legs
  │                    (`binary` job pays team pairs daily, if switched on)
  ├─ refund later ─▶ reversal entries (never edits); can take the wallet negative
  ▼
Withdrawal request ── AVAILABLE → RESERVED (one open request, verified bank account)
  ▼  admin approves ─▶ batch (CSV for the bank) ─▶ settled with bank reference + evidence
PAID_OUT              (failed or rejected: RESERVED → AVAILABLE)
```

Wallet balances are never stored: they are the sum of `LedgerEntry` rows by bucket. Every entry has a unique idempotency key, so retries can't post twice. `reconcile-ledger` checks the ledger against commissions and withdrawals every day.

## Key modules

| Module | Responsibility |
| --- | --- |
| `orders.ts`, `checkout-math.ts`, `discounts.ts`, `inventory.ts` | Cart, server-side pricing (VAT, delivery, discounts), stock reservation, order lifecycle |
| `payments/service.ts`, `payments/paystack.ts`, `payments/test-provider.ts` | Starting payments, verifying events, idempotent state changes |
| `refunds.ts`, `returns.ts` | Full and partial refunds, gateway refunds, returns |
| `commissions.ts`, `binary.ts`, `comp-plan.ts`, `settings.ts` | Plan versions, direct commission, maturing, binary pairing, holds |
| `tree.ts`, `volume.ts` | Placement (spillover, admin queue), volume ledger and reconciliation |
| `ledger.ts`, `wallet.ts`, `payouts/*` | Wallet ledger, withdrawals, batches, bank accounts (encrypted) |
| `auth.ts`, `session.ts`, `mfa.ts`, `totp.ts`, `rate-limit.ts` | Passwords, sessions, two-step sign-in, access checks, rate limits |
| `audit.ts`, `log.ts` | Hash-chained audit log; error logging with secrets scrubbed |
| `reports.ts`, `exports.ts`, `health.ts` | Admin reports, CSV exports, system health |

## Concurrency

Races are handled in the database, not in memory, so it works with any number of app instances:

- Stock: conditional updates (`stock >= qty`) plus CHECK constraints.
- Payments: unique provider reference and webhook event id; the order row is locked while it changes state.
- Wallets: an advisory lock per member around every ledger posting; withdrawals check the balance inside that lock.
- Tree: unique `(parentId, position)`; the insert trigger checks each position's path.
- Jobs: idempotent, with row locks (`FOR UPDATE SKIP LOCKED` for email) and unique keys (binary period).

## Configuration

Settings that change behaviour (plan, shop, brand, pause switches) live in the `Setting` table and are edited in *Admin → Settings* and *Emergency operations*; the plan is versioned. Secrets and infrastructure live in environment variables (`docs/DEPLOYMENT.md`).
