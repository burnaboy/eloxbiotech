# Deliverables

Where each required deliverable lives in this repository. Paths are from the repository root.

| # | Deliverable | Where | Status |
| --- | --- | --- | --- |
| 1 | Complete working source code | The whole repository; app code in `src/`, built with `npm run build` | Done; release check passes (`TEST-REPORT.md`) |
| 2 | Clear folder structure | `README.md` › Project layout; summary below | Done |
| 3 | Database schema and migrations | `prisma/schema.prisma`; 16 migrations in `prisma/migrations/` (SQL triggers and checks included); `prisma/seed.ts` | Done; applied from scratch twice with identical results |
| 4 | Public website and catalogue | `src/app/(shop)` (home, categories, search, product pages, cart), `src/app/(content)` (policies, about, contact); `src/lib/catalog.ts` | Done |
| 5 | Authentication and authorization | `src/app/(auth)`; `src/lib/auth.ts`, `session.ts`, `mfa.ts`, `totp.ts`, `rate-limit.ts`; admin permissions in `src/app/admin/actions.ts` (`act`) | Done |
| 6 | Customer checkout | `src/app/(shop)/checkout`, `src/lib/orders.ts`, `checkout-math.ts`, `inventory.ts`, `discounts.ts` | Done |
| 7 | Paystack integration | `src/lib/payments/` (`paystack.ts`, `service.ts`, `keys.ts`, `gateway-reconciliation.ts`); webhook `src/app/api/webhooks/[provider]/route.ts`; `src/lib/refunds.ts` | Built; tested with recorded responses. Staging test-mode run outstanding |
| 8 | Affiliate referral system | `src/app/r/[code]` (referral links), `src/app/dashboard` (links, sales, team), `src/lib/users.ts` | Done |
| 9 | Binary network engine | `src/lib/tree.ts` (placement, spillover), `volume.ts`, `binary.ts` (pairing), `tree-view.ts`; tree rules in migrations | Done; binary pay off by default |
| 10 | Commission services | `src/lib/commissions.ts`, `comp-plan.ts`, `binary.ts`, `refunds.ts` | Done; rates are placeholders |
| 11 | Auditable ledger | `src/lib/ledger.ts` (wallet ledger, append-only), `src/lib/audit.ts` (hash-chained audit log) | Done |
| 12 | Member dashboard | `src/app/dashboard` (affiliates), `src/app/account` (all members); `src/lib/member-overview.ts`, `wallet.ts` | Done |
| 13 | Admin dashboard | `src/app/admin/**`; `src/lib/reports.ts`, `exports.ts`, `health.ts` | Done |
| 14 | Withdrawal workflow | `src/lib/wallet.ts`, `src/lib/payouts/`; `src/app/dashboard/payouts`, `src/app/admin/payouts` | Done (manual bank batches) |
| 15 | Automated tests | `tests/` (Vitest, 10 files), `e2e/` (Playwright, 4 files); `scripts/release-check.sh` runs everything | Done |
| 16 | Environment variable example | `.env.example`; every variable explained in `docs/DEPLOYMENT.md` | Done |
| 17 | README with installation instructions | `README.md` | Done |
| 18 | API documentation | `docs/API.md` | Done |
| 19 | Database and architecture documentation | `docs/DATABASE.md`, `docs/ARCHITECTURE.md` | Done |
| 20 | Deployment guide | `docs/DEPLOYMENT.md`, `docs/HOSTING.md`, `render.yaml`, `Dockerfile`, `.github/workflows/ci.yml`; operations in `docs/RUNBOOKS.md`, `docs/MONITORING.md`, `docs/INCIDENT-RESPONSE.md` | Written and run locally; not yet run on Render or GitHub |
| 21 | Security checklist | `docs/SECURITY-CHECKLIST.md`; threat model in `docs/SECURITY.md` | Done |
| 22 | Test report | `docs/TEST-REPORT.md`; raw output in `.release-check/` | Done |
| 23 | Known limitations and production-readiness assessment | `docs/READINESS.md` | Done |

Also included: `docs/COMMANDS.md` (exact commands for every stage), `docs/COMPLIANCE.md` (legal questions for a Nigerian lawyer), `docs/ADMIN-GUIDE.md` (day-to-day running), `docs/ACCEPTANCE.md` (each acceptance criterion and its test), `docs/PHASES.md` (delivery report by phase).

## Folder structure

```
.
├── src/
│   ├── app/                  Pages, server actions and HTTP routes (Next.js App Router)
│   │   ├── (shop)/           Storefront, product pages, cart, checkout, orders
│   │   ├── (auth)/           Sign-up, sign-in, two-step codes, password reset
│   │   ├── (content)/        Policies and information pages
│   │   ├── account/          Profile, addresses, security, preferences
│   │   ├── dashboard/        Affiliate area: links, team tree, commissions, wallet
│   │   ├── admin/            Admin area and its server actions
│   │   ├── support/          Support tickets
│   │   ├── notifications/    In-app notifications
│   │   ├── r/[code]/         Referral links
│   │   ├── media/            Local image serving (development)
│   │   └── api/              Webhooks, scheduled jobs, health checks
│   ├── lib/                  Business logic (orders, payments, commissions, ledger, tree, wallet…)
│   │   ├── payments/         Paystack client, payment service, reconciliation
│   │   └── payouts/          Bank accounts (encrypted) and bank list
│   ├── middleware.ts         Security headers and content security policy
│   └── instrumentation.ts    Captures unhandled server errors
├── prisma/                   schema.prisma, migrations/ (with SQL rules), seed.ts
├── tests/                    Unit and integration tests (Vitest, real PostgreSQL)
├── e2e/                      Browser tests (Playwright, production build)
├── scripts/                  Release check, migration guard, scheduler, restore verification
├── docs/                     All documentation
├── Dockerfile, render.yaml   Container image and Render hosting Blueprint
└── .github/workflows/ci.yml  Continuous integration
```
