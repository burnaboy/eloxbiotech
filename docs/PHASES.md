# Delivery report by phase

Status of the ten development phases, as of 21 October 2026. Results are from runs actually executed on that date. The release check (`scripts/release-check.sh`) passed in full on the final commit:

- 107 of 107 unit and integration tests, in 10 files, against a real PostgreSQL 16 database.
- 10 of 10 browser tests (Chromium, desktop and mobile), against the production build.
- Migrations applied from scratch twice, giving identical schemas with no drift from `schema.prisma`; no unapproved destructive migrations.
- Production build: 104 browser files scanned, no secrets found.
- Server log from the browser run: no passwords, secrets or session tokens.
- Backup and restore: row counts match, and the audit chain, wallet ledger and network volume checks pass on the restored copy.

Evidence: `.release-check/` (also kept by CI as a downloadable artifact).

Phases 1–9 were built across sections 1–20 of the specification; their reports were given section by section. The summary below collects them in one place. Phase 10 was completed with this report.

## Phase 1: Requirements, architecture, threat model, database design

- **Built:** the domain model (members, tree, orders, payments, commissions, ledger, withdrawals, audit); integer kobo money; versioned compensation plan; materialised-path tree; threat model.
- **Files:** `prisma/schema.prisma`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/SECURITY.md`, `docs/COMPLIANCE.md`.
- **Tests:** see phases 2–9; the design rules each have a database-level test (`acceptance.test.ts`, `network.test.ts`, `money.test.ts`).
- **Open:** compensation plan numbers are placeholders awaiting the business's figures and legal sign-off. The decision on binary team pay (retail-only, as built by default) is still waiting for an answer.

## Phase 2: Setup, database, migrations, authentication

- **Built:**
  - Next.js 15 and Prisma 6 with 16 migrations.
  - Argon2id passwords, sessions, email verification and password reset.
  - Two-step sign-in (TOTP) with recovery codes; rate limits; roles and per-admin permissions.
- **Files:** `src/lib/auth.ts`, `session.ts`, `mfa.ts`, `totp.ts`, `rate-limit.ts`, `users.ts`, `src/app/(auth)`, `prisma/migrations/*`.
- **Tests:** `flow.test.ts` (accounts), `totp.test.ts`, `acceptance.test.ts` (authentication), `e2e/01`, `e2e/03`, `e2e/04`. All pass.
- **Open:** none.

## Phase 3: Public website, catalogue, cart, checkout

- **Built:**
  - Storefront, categories, search, product options, sale prices and stock.
  - Cart, and checkout with delivery and VAT computed on the server.
  - Discount codes, receipts, returns.
  - Legal pages and the complaints process.
- **Files:** `src/app/(shop)`, `src/app/(content)`, `src/lib/orders.ts`, `checkout-math.ts`, `catalog.ts`, `inventory.ts`, `discounts.ts`, `images.ts`, `storage.ts`.
- **Tests:** `catalog.test.ts`, `money.test.ts` (checkout safety), `acceptance.test.ts` (e-commerce), `e2e/01`, `e2e/02`. All pass.
- **Open:** no email provider is connected. Emails are queued but not sent. **This blocks launch.**

## Phase 4: Paystack integration and payment verification

- **Built:**
  - Paystack checkout, with signature-checked webhooks and every event re-verified with Paystack.
  - Amount and currency checks; idempotent handling across webhook, callback and reconciliation.
  - Refunds and disputes.
  - A test gateway for development.
  - Live keys refused until go-live is approved.
  - A daily check of Paystack's records against ours.
- **Files:** `src/lib/payments/*`, `src/app/api/webhooks/[provider]/route.ts`, `src/lib/refunds.ts`.
- **Tests:** `paystack.test.ts`, `money.test.ts` (payment events, Paystack client), `flow.test.ts`, `acceptance.test.ts` (payments, reconciliation), `ops.test.ts`. All pass.
- **Open:** never run against Paystack's servers from this environment. That happens in staging with test keys (go-live checklist in `docs/HOSTING.md`).

## Phase 5: Affiliate attribution and binary placement

- **Built:**
  - Referral links and sponsor attribution.
  - Automatic or admin-approved placement, with spillover.
  - Placements made permanent in the database, with path checks on every new position.
  - Retail-only team volume.
- **Files:** `src/lib/tree.ts`, `volume.ts`, `tree-view.ts`, `src/app/r/[code]`, `src/app/dashboard/tree`, `src/app/admin/network`.
- **Tests:** `network.test.ts`, `flow.test.ts` (placement), `acceptance.test.ts` (binary network). All pass.
- **Open:** whether to switch binary pay on at all (legal question; off by default).

## Phase 6: Commission rules, ledger, refunds, reconciliation

- **Built:**
  - Direct commission on verified customer sales after a return window.
  - Binary pairing with caps and carry.
  - Holds, and reversals on refunds and chargebacks.
  - A permanent, double-entry-style wallet ledger.
  - Daily ledger and volume reconciliation.
- **Files:** `src/lib/commissions.ts`, `binary.ts`, `comp-plan.ts`, `ledger.ts`, `refunds.ts`.
- **Tests:** `binary.test.ts`, `money.test.ts`, `flow.test.ts`, `acceptance.test.ts` (commissions). All pass.
- **Open:** none known.

## Phase 7: Member dashboard, wallet, withdrawals

- **Built:**
  - Affiliate dashboard: sales, team, tree, commissions.
  - Wallet with balances by stage.
  - Bank accounts, verified by name and encrypted, with a 24-hour cooling-off.
  - Withdrawal requests: one open at a time, idempotent.
- **Files:** `src/app/dashboard`, `src/lib/wallet.ts`, `src/lib/payouts/*`, `src/lib/member-overview.ts`.
- **Tests:** `money.test.ts` (withdrawals, dashboard figures), `flow.test.ts` (payouts), `acceptance.test.ts` (wallet), `e2e/02`. All pass.
- **Open:** none.

## Phase 8: Admin dashboard, inventory, orders, reports

- **Built:**
  - Admin areas for orders, returns, products and stock, members, network, commissions, the ledger, withdrawals in bank batches with evidence, and support.
  - Reports and CSV exports.
  - Risk and reconciliation checks, system health, the audit log, the admin team, and emergency switches.
  - High-risk steps need a reason, a typed confirmation and a fresh two-step code.
- **Files:** `src/app/admin/**`, `src/lib/reports.ts`, `exports.ts`, `health.ts`, `audit.ts`, `csv.ts`.
- **Tests:** `admin.test.ts`, `acceptance.test.ts` (audit of privileged actions), `e2e/03`, `e2e/04`. All pass.
- **Open:** none.

## Phase 9: Tests, security review, accessibility, performance

- **Built:**
  - Release acceptance tests, plus a browser test that tries every admin action as a guest, a customer and an affiliate.
  - Security headers and a nonce-based content security policy.
  - Scrubbed logging; indexes and paged lists.
  - Accessibility basics: labels, keyboard use, table headers, focus.
- **Files:** `tests/*`, `e2e/*`, `src/middleware.ts`, `docs/ACCEPTANCE.md`, `docs/SECURITY.md`.
- **Tests:** everything above. A deliberately broken admin check was confirmed to fail the access test.
- **Open:**
  - The build-tool advisories listed in `SECURITY.md`; none affects the running server.
  - An external penetration test before launch.
  - Screen-reader and cross-browser testing, which has been Chromium only.

## Phase 10: Deployment, monitoring, backup recovery, handover

- **Built:**
  - A container image (`Dockerfile`) for the app and for migrations.
  - CI (`.github/workflows/ci.yml`) running all release checks and building the images.
  - A Render Blueprint (`render.yaml`) for staging and production, with managed PostgreSQL 16 in Frankfurt and a one-minute scheduler (`scripts/run-scheduled.mjs`).
  - A guard against data-destroying migrations (`scripts/check-migrations.ts`).
  - JSON logs; capture of every unhandled error, with optional chat alerts.
  - A token-protected detailed health check for uptime monitors.
  - Daily Paystack reconciliation; a restore verification script.
  - Documentation: hosting, deployment and rollback, monitoring, runbooks, admin guide, README.
- **Files:**
  - New: `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml`, `render.yaml`, `src/instrumentation.ts`, `src/app/api/health/status/route.ts`, `src/lib/payments/keys.ts`, `src/lib/payments/gateway-reconciliation.ts`, `scripts/run-scheduled.mjs`, `scripts/check-migrations.ts`, `tests/ops.test.ts`, `docs/HOSTING.md`, `docs/RUNBOOKS.md`, `docs/MONITORING.md`, `docs/ADMIN-GUIDE.md`, `docs/ARCHITECTURE.md`, `docs/PHASES.md`, `README.md`.
  - Changed: `src/lib/log.ts`, `health.ts`, `email.ts`, `payments/paystack.ts`, `payouts/banks.ts`, `src/app/api/cron/[job]/route.ts`, `src/app/layout.tsx`, `scripts/release-check.sh`, `playwright.config.ts`, `e2e/04-access.spec.ts`, `tests/admin.test.ts`, `tests/acceptance.test.ts`, `package.json`, `docs/DEPLOYMENT.md`, `docs/DATABASE.md`, `docs/SECURITY.md`, `docs/ACCEPTANCE.md`, `.env.example`.
- **Tests run:**
  - The full release check (results at the top).
  - The release check again in a clean copy with no local settings file: passed.
  - Container: the app image and migration image built; migrations ran from the image into a fresh PostgreSQL 16 container. The app container served the home, product, policy and sign-in pages, the health check and a scheduled job. It reported healthy, runs as a non-root user, and processed images.
  - Render steps run locally: the migration guard, `migrate deploy`, the standalone server with static files, and the scheduler calling three jobs.
  - Error capture: an unhandled database error was logged as one JSON line with no password or email in it.
- **Not run here:**
  - The GitHub Actions workflow itself, which needs the repository on GitHub.
  - The Render Blueprint, which needs a Render account.
  - Calls to Paystack's servers.

  These are the first steps of the go-live checklist.
- **Open defects and risks:**
  1. No email provider: emails aren't sent (launch blocker).
  2. Next.js still prints its own plain-text error line next to the structured one; it hasn't shown secrets in tests, but log alerts should key on the JSON `event` field.
  3. Daily off-site database dumps (beyond Render's recovery window) need setting up with the hosting account.
  4. The app role / owner role split on Render is a post-launch hardening step.
  5. Encryption key rotation needs a script before it's ever needed.
  6. The restore test used the test data set (111 rows); repeat with a staging copy.

## Next phase

There is no eleventh phase. What remains needs people or accounts:

1. Choose and connect an email provider.
2. Answer the binary-pay decision and get the plan's numbers and legal sign-off.
3. Push the code to GitHub and apply `render.yaml`.
4. Run the go-live checklist in test mode.
5. Give written go-live approval.
