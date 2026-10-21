# Test report

Results of the full release check (`scripts/release-check.sh`), run on 21 October 2026 on the final code (section 24 changes included). Every figure below was read from that run's output, kept in `.release-check/`.

**Result: all release checks passed (exit code 0).**

## Environment

- Node.js 22.22.0, Next.js 15.5.28, PostgreSQL 16.15, Prisma 6.19
- Linux container; Chromium (Playwright) for browser tests
- Payments through the built-in test gateway and recorded Paystack responses. No real Paystack, email or bank calls

## Summary

| Step | What | Result |
| --- | --- | --- |
| 1 | Type check, then unit and integration tests (Vitest, real PostgreSQL `mlm_test`) | 108 of 108 passed, 10 files, 33.4 s |
| 2 | Migration guard; all 16 migrations applied to two empty databases and compared; drift against `schema.prisma` | 0 blocked; 40 tables, 7 triggers, 23 checks, identical both times; no drift |
| 3 | Production build with throwaway secret values, then every browser file searched for them | Build succeeded; 104 files scanned, no secrets or server-only fields |
| 4 | Browser tests (Playwright) against the production build, desktop and mobile | 12 of 12 passed, 1.1 min |
| 5 | Server log from step 4 searched for passwords, secrets, keys, database credentials and session tokens | 7 lines, none found |
| 6 | Backup with `pg_dump`, restored to a new database, verified | 117 rows in 39 tables match; audit chain, wallet ledger and network volume checks pass |

## Unit and integration tests by file

| File | Tests | Passed | Covers |
| --- | --- | --- | --- |
| `acceptance.test.ts` | 14 | 14 | The specification's acceptance criteria end to end (`ACCEPTANCE.md`) |
| `money.test.ts` | 26 | 26 | Kobo maths, VAT, refunds, payment idempotency, ledger, withdrawals, audit chain |
| `flow.test.ts` | 19 | 19 | Accounts, placement, checkout, webhooks, commissions, disputes, concurrent withdrawals |
| `catalog.test.ts` | 16 | 16 | Prices, options, stock, overselling, images |
| `admin.test.ts` | 8 | 8 | Exports, reports, job tracking, rate limits, log scrubbing and alerts |
| `network.test.ts` | 8 | 8 | Sponsorship, permanent placement, no pay for recruiting, volume |
| `binary.test.ts` | 6 | 6 | Pairing, caps, carry; 2:1 checked against brute force |
| `paystack.test.ts` | 5 | 5 | Signatures, re-verification, event mapping |
| `ops.test.ts` | 4 | 4 | Live-key rule, simulated gateway never in production, migration guard, scheduler |
| `totp.test.ts` | 2 | 2 | RFC 6238 test vector, secret format |
| **Total** | **108** | **108** | |

## Browser tests

| Test | Desktop | Mobile |
| --- | --- | --- |
| Guest can browse the shop and read the policies | Passed | Passed |
| Protected pages send guests to sign in | Passed | Passed |
| Referred customer registers, verifies email, buys with a test payment; sponsor gets a pending commission | Passed | Not run |
| Affiliate sees referral links, the tree and the pending commission | Passed | Not run |
| Super admin sets up two-step sign-in, ships an order, needs a fresh code to refund | Passed | Not run |
| A second sign-in for a two-step account asks for the code | Passed | Not run |
| Guests and members can't use admin pages, exports or any admin action (database unchanged) | Passed | Not run |
| Members can't see others' orders; jobs, health status and webhooks need their secrets | Passed | Not run |
| Pages fit the screen without sideways scrolling, signed out and signed in | Passed | Passed |

Only the storefront tests run at mobile size by design; the rest are desktop only.

## Earlier runs (not repeated today)

From phase 10 (`PHASES.md`): the release check in a clean copy without a local settings file; the Docker app and migration images built and run against a fresh PostgreSQL container; the Render deploy steps run locally; error capture checked for leaks. All passed at the time.

## Not tested

- Paystack's real servers, GitHub Actions, Render, an email provider, a real bank
- Browsers other than Chromium; screen readers
- Load and performance under production traffic
- Restore of a production-sized database

See `READINESS.md` for how each is planned.

## Defects found and fixed during testing

Found while building the acceptance and operations tests (sections 20–22), all fixed and covered by tests:

1. Overlapping runs of the email job sent each email four times. Fixed with a row lock (`acceptance.test.ts`, overlapping jobs).
2. Fractional cart quantities were accepted. Fixed (`acceptance.test.ts`, invalid quantities).
3. Two admin actions (mature now, move image) didn't write audit records. Fixed (`acceptance.test.ts`, audit entries).
4. The database didn't check a new tree position's path or stop a second root. Fixed with a trigger and unique index (`acceptance.test.ts`, database refuses).
5. Section 24 review: the seed script created nine buyable sample products in production, and `ALLOW_TEST_PAYMENTS=true` could have switched on the simulated gateway in the live environment. Now production gets no sample products, and the simulated gateway is refused whenever `APP_ENV=production` or live payments are approved (`ops.test.ts`; the seed was checked against a scratch database with production and staging settings).

6. Interface review with screenshots: the font setting pointed to an undefined variable, so every page used the browser's serif fallback; the affiliate, account and admin pages were wider than a phone screen; the dashboard said "1 members". All fixed; the new browser test failed on the old build and passes now.

## Open defects

None known in the tested code. Open risks are in `READINESS.md`.
