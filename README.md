# Elox BioTech

An online shop for Nigeria (prices in naira, payments through Paystack) with an affiliate programme: members earn commission on genuine product sales to customers they refer, tracked in a binary (two-leg) team tree. Built with Next.js 15, PostgreSQL 16 and Prisma.

**Status:** feature-complete for a pilot, with all release checks passing. Not yet launched. Before launch: connect an email provider, get Nigerian legal sign-off on the compensation plan (`docs/COMPLIANCE.md`), and complete the first-deploy steps in `docs/DEPLOYMENT.md`.

## What's in it

- **Shop:** catalogue with options, sale prices and stock; cart; checkout with delivery and VAT; Paystack payments verified on the server; receipts, returns and refunds.
- **Affiliates:** referral links, binary tree placement (automatic or admin-approved), direct commission on customer sales after a return window, optional team (binary) pay, wallet, withdrawals to a verified Nigerian bank account.
- **Admin:** orders, stock, members, network, commissions, withdrawals in batches with bank evidence, reports and CSV exports, risk and reconciliation checks, system health, audit log, emergency pause switches. Permissions per admin; two-step sign-in required.
- **Light and dark mode:** a switch in the header (System, Light, Dark), remembered on each device; brand colours are lightened automatically so they stay readable in dark mode.
- **Safeguards:** money in whole kobo; a permanent wallet ledger; a tamper-evident audit log; plan versions that never change after use; database rules that stop overselling, double payment, double commission, moving members in the tree, and editing financial history.

## Run it locally

Step-by-step guide for Windows and Mac, including Docker, live reload and pushing changes: [docs/LOCAL-SETUP.md](docs/LOCAL-SETUP.md).

Needs Node 22 and PostgreSQL 16.

```sh
docker run -d --name mlm-db -p 5432:5432 -e POSTGRES_USER=mlm -e POSTGRES_PASSWORD=mlm -e POSTGRES_DB=mlm postgres:16   # or use a local Postgres
cp .env.example .env            # test-mode values only; set APP_ENCRYPTION_KEY with: openssl rand -base64 32
npm ci
npx prisma migrate deploy
SEED_ADMIN_PASSWORD='choose-one' SEED_DEMO=1 npm run seed    # admin@eloxbiotech.local plus demo members (password Password123)
npm run dev                     # http://localhost:3000
```

Payments use a built-in test gateway (`PAYMENT_PROVIDER=test`), which shows a "Pay successfully / Decline" page instead of Paystack. To try Paystack's own test mode, set `PAYMENT_PROVIDER=paystack` and a `sk_test_…` key; the app refuses live keys outside production. Emails are stored in the `EmailOutbox` table rather than sent.

## Tests

| Command | What |
| --- | --- |
| `npm test` | Unit and integration tests against a real database (`mlm_test`) |
| `npm run test:e2e` | Browser tests against the production build (`mlm_e2e`); run `npm run build` first |
| `scripts/release-check.sh` | Everything needed to release: the above, plus migrations from scratch, secret scan of browser files, log scan, and a backup-restore test |

Create the test databases once: `createdb mlm_test && createdb mlm_e2e` (same user as above). Every acceptance criterion and the test that proves it: `docs/ACCEPTANCE.md`.

## Project layout

| Path | What |
| --- | --- |
| `src/app` | Pages and server actions: `(shop)`, `(auth)`, `(content)`, `account`, `dashboard` (affiliates), `admin`, `api` (webhooks, scheduled jobs, health) |
| `src/lib` | Business logic. Start with `orders.ts`, `payments/service.ts`, `commissions.ts`, `ledger.ts`, `wallet.ts`, `tree.ts`, `refunds.ts` |
| `prisma` | Schema, migrations (with the database rules in SQL), seed |
| `tests`, `e2e` | Vitest and Playwright tests |
| `scripts` | Release checks, restore verification |
| `docs` | Everything below |

## Documentation

| Document | For |
| --- | --- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it fits together; the money flow from order to withdrawal |
| [DATABASE.md](docs/DATABASE.md) | Rules the database enforces, indexes, tree design, background jobs |
| [SECURITY.md](docs/SECURITY.md) | Threat model and controls; open security items |
| [COMPLIANCE.md](docs/COMPLIANCE.md) | Legal review and questions for the Nigerian lawyer |
| [HOSTING.md](docs/HOSTING.md) | Recommended hosting (staging and production on Render), costs, setup, go-live checklist |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Environment variables, first deploy, releases, rollback |
| [RUNBOOKS.md](docs/RUNBOOKS.md) | Payment reconciliation, withdrawals, dependency updates, migrations, backups, secrets |
| [MONITORING.md](docs/MONITORING.md) | What to watch and what to alert on |
| [INCIDENT-RESPONSE.md](docs/INCIDENT-RESPONSE.md) | Incidents, backups and restore |
| [ADMIN-GUIDE.md](docs/ADMIN-GUIDE.md) | Day-to-day running for the operations team |
| [ACCEPTANCE.md](docs/ACCEPTANCE.md) | Release criteria and the tests that prove them |
| [PHASES.md](docs/PHASES.md) | Delivery report by phase, with results and open risks |
| [API.md](docs/API.md) | HTTP endpoints, webhooks, scheduled jobs, server actions |
| [SECURITY-CHECKLIST.md](docs/SECURITY-CHECKLIST.md) | Pre-launch security checklist: built controls and open items |
| [TEST-REPORT.md](docs/TEST-REPORT.md) | Results of the latest full release check |
| [READINESS.md](docs/READINESS.md) | Known limitations and production-readiness assessment |
| [DELIVERABLES.md](docs/DELIVERABLES.md) | Where each required deliverable lives |
| [LOCAL-SETUP.md](docs/LOCAL-SETUP.md) | Beginner guide: run the app on your laptop and push changes to GitHub |
| [COMMANDS.md](docs/COMMANDS.md) | Exact commands: local development, migrations, tests, build, deployment |
