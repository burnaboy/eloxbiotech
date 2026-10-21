# Security checklist

A pre-launch checklist. **Done** items are built into the code and covered by a test or a release-check step (named in the last column). **Open** items need a person, an account or a decision before go-live. The threat model and reasoning behind each control are in `SECURITY.md`.

Status as of 21 October 2026.

## Built and tested

| # | Control | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Passwords hashed with Argon2id; unknown emails take the same time as known ones | Done | `acceptance.test.ts` (registration), `flow.test.ts` |
| 2 | Two-step sign-in (TOTP) required for every admin; single-use codes; hashed recovery codes | Done | `totp.test.ts`, `e2e/03-admin` |
| 3 | Fresh two-step code (10 min) for refunds, wallet corrections, payouts, placement, plan changes and exports | Done | `e2e/03-admin` (refund asks for a fresh code), `acceptance.test.ts` |
| 4 | Every admin action checks permission before doing anything | Done | `acceptance.test.ts` (static check of all 47 actions); `e2e/04-access` (every action posted by a guest, a customer and an affiliate; database unchanged) |
| 5 | Members can only see their own orders, receipts, tickets, payouts | Done | `e2e/04-access` (404 on another member's order) |
| 6 | Sessions: random 256-bit token, only the hash stored, new token per sign-in, HttpOnly, SameSite=Lax, Secure in production | Done (code; no dedicated test) | `src/lib/auth.ts`, `src/lib/session.ts`; `e2e/03-admin` covers sign-in and second sign-in |
| 7 | Rate limits on sign-in, sign-up, codes, checkout, withdrawals, bank changes, support, exports; forged `X-Forwarded-For` ignored | Done | `flow.test.ts` (lockout after failed sign-ins), `admin.test.ts` (rate limits per key). The forged-header rule is in code only (`src/lib/session.ts`) |
| 8 | Paystack webhooks: HMAC-SHA512 signature in constant time, then every success re-verified with Paystack | Done | `paystack.test.ts`, `e2e/04-access` (forged webhook gets 401) |
| 9 | Amount, currency and reference must match before an order is paid; repeats change nothing | Done | `flow.test.ts`, `money.test.ts`, `acceptance.test.ts` |
| 10 | Live Paystack keys refused unless production, not staging, and `LIVE_PAYMENTS_APPROVED=true` | Done | `ops.test.ts` |
| 10a | Simulated payment gateway refused in the live environment (`APP_ENV=production`) or once live payments are approved; no sample products or demo members seeded in production | Done | `ops.test.ts`; seed checked on a scratch database |
| 11 | Prices, totals, VAT and delivery computed on the server from the database | Done | `acceptance.test.ts`, `catalog.test.ts` |
| 12 | Stock can't be oversold, even with simultaneous checkouts | Done | `catalog.test.ts`, `flow.test.ts` |
| 13 | Wallet ledger is append-only (database trigger), idempotency keys unique | Done | `money.test.ts`, `acceptance.test.ts` |
| 14 | Audit log append-only and hash-chained; tampering detected | Done | `money.test.ts`, restore check (`verify-restore.ts`) |
| 15 | Tree placements permanent; database rejects same-leg, cycles, bad paths, second root | Done | `acceptance.test.ts`, `network.test.ts` |
| 16 | Withdrawals can't exceed the available balance, even with simultaneous requests; paid only with a unique transfer reference and evidence | Done | `flow.test.ts`, `money.test.ts`, `acceptance.test.ts` |
| 17 | Bank account numbers encrypted (AES-256-GCM), shown masked; 24-hour wait after a change | Done | `money.test.ts` (cooling-off). Encryption is in code only (`src/lib/payouts/accounts.ts`), no dedicated test |
| 18 | Content Security Policy with per-request nonce; HSTS; frame, sniffing and referrer headers | Done (code; no dedicated test) | `src/middleware.ts`, `next.config.mjs`; all browser tests run with the policy switched on |
| 19 | Uploads admin-only, content-sniffed, size-limited, re-encoded to WebP, served sandboxed | Done | `catalog.test.ts` (real images only, re-encoded; safe file names) |
| 20 | CSV exports: permission, fresh code, same-site only, rate limited, audited, spreadsheet formulas neutralised | Done | `admin.test.ts`, `e2e/04-access` |
| 21 | No secrets in browser files | Done | Release check step 3 (canary secrets and key patterns searched in every built file) |
| 22 | No secrets or passwords in logs; errors scrubbed | Done | Release check step 5; `admin.test.ts` (scrubbed JSON log line) |
| 23 | Scheduled jobs need `CRON_SECRET`; detailed health needs a separate `MONITOR_TOKEN` and shows no values | Done | `e2e/04-access` |
| 24 | Migrations that could destroy data blocked unless approved in writing | Done | `ops.test.ts`, release check step 2, Render pre-deploy command |
| 25 | Backups restore with every integrity check passing | Done | Release check step 6 |
| 26 | Containers run as a non-root user | Done | `Dockerfile`; checked when the image was run (phase 10) |

## Before go-live (open)

| # | Item | Owner | Notes |
| --- | --- | --- | --- |
| A | All production secrets generated fresh and stored only in Render's secret settings | Operator | `docs/HOSTING.md`; never reuse staging values |
| B | `APP_ENCRYPTION_KEY` backed up separately from the database | Operator | Losing it makes bank account numbers unreadable |
| C | Separate database roles: migrations as owner, app as a non-owner | Operator | Hardening step; stops the app role disabling the immutability triggers (`SECURITY.md`, service credentials) |
| D | External penetration test | Business | Before taking real money |
| E | Paystack: test-mode run on staging, webhook URL and IP allow-listing set, dashboard 2FA for every Paystack user | Operator | Go-live checklist in `docs/HOSTING.md` |
| F | Admin accounts: real people only, each with their own two-step device; demo accounts never seeded in production | Operator | `SEED_DEMO` must be unset in production |
| G | Error alerts and uptime monitor connected | Operator | `docs/MONITORING.md` |
| H | Off-site daily database dumps, beyond the host's recovery window | Operator | `docs/RUNBOOKS.md` |
| I | Encryption key rotation script written and rehearsed | Developer | Not automated yet |
| J | Build-tool advisories cleared by upgrading Next.js 16, Prisma 7, Tailwind 4 | Developer | 0 critical, 9 high, 3 moderate on 21 October 2026, all build or test tooling, none reachable from a request |
| K | Data protection: privacy notice reviewed under the Nigeria Data Protection Act 2023, retention periods agreed | Business and lawyer | `docs/COMPLIANCE.md` |
| L | Written go-live approval, then `LIVE_PAYMENTS_APPROVED=true` | Business | Code refuses live keys until then |
