# Deployment and rollback

How to put Binary Commerce into service, release new versions, and undo a bad release. The recommended host and its setup are in `docs/HOSTING.md`; this document applies to any host. Restoring data from backups is in `docs/INCIDENT-RESPONSE.md`.

## What runs where

| Part | What | Notes |
| --- | --- | --- |
| Web app | Next.js 15 server (`output: "standalone"`), Node 22 | Stateless: run two or more instances behind a load balancer with HTTPS |
| Database | PostgreSQL 16, managed, with point-in-time recovery | The only place state lives (sessions, rate limits and job status included) |
| Product images | S3-compatible bucket (`STORAGE_DRIVER=s3`) with versioning on | Local disk storage is refused in production |
| Payments | Paystack | Webhook to `https://<domain>/api/webhooks/paystack` |
| Scheduler | Any cron service that can send an HTTPS POST | Calls `/api/cron/<job>` with `Authorization: Bearer $CRON_SECRET` |
| Email | Queued in the `EmailOutbox` table | **Before launch:** connect an email provider in `src/lib/email.ts`; today only `EMAIL_PROVIDER=log` exists, which stores mail without sending |

## Environment variables

Set these in the host's secret store, never in the repository. The app refuses unsafe combinations in production (test payments, local file storage, demo data).

| Variable | Required | Value |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` |
| `DATABASE_URL` | yes | App role with read/write on tables, **not** the owner. `?sslmode=require` |
| `APP_URL` | yes | `https://your-domain` (turns on secure cookies and `upgrade-insecure-requests`) |
| `APP_ENCRYPTION_KEY` | yes | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts bank numbers and two-step secrets. Keep an offline copy: without it they can't be read |
| `CRON_SECRET` | yes | Long random string (`openssl rand -hex 32`) |
| `MONITOR_TOKEN` | yes | Another long random string, for the external monitor (`docs/MONITORING.md`) |
| `PAYMENT_PROVIDER` | yes | `paystack` |
| `PAYSTACK_SECRET_KEY` | yes | `sk_live_…` in production only; `sk_test_…` everywhere else |
| `PAYOUT_VERIFICATION` | no | `paystack` (default with Paystack) checks account names; `manual` skips |
| `STORAGE_DRIVER` | yes | `s3` |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL` | yes | Key scoped to this one bucket. `S3_ENDPOINT` only for non-AWS (R2, Spaces, B2) |
| `EMAIL_PROVIDER` | yes | Provider name once one is added (see above) |
| `APP_ENV` | yes | `staging` or `production`. In staging the app refuses live Paystack keys; shown in error alerts |
| `LIVE_PAYMENTS_APPROVED` | production | `false` until the business approves go-live in writing; a live key (`sk_live_…`) is refused until it's `true` |
| `ERROR_ALERT_WEBHOOK` | no | Team chat webhook (Slack, Google Chat, Discord): one message per error type per 5 minutes, scrubbed |
| `LOG_FORMAT` | no | `json` (default in production) or `text` |
| `TRUSTED_PROXY_HOPS` | no | Number of proxies in front of the app that append `X-Forwarded-For` (default 1). Wrong values weaken rate limits |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | first deploy only | The first super admin. Remove after first sign-in |

Never set in production: `ALLOW_TEST_PAYMENTS`, `ALLOW_LOCAL_STORAGE`, `TEST_PAYMENT_SECRET`, `SEED_DEMO`.

## Database roles

Use two roles:

- **Owner/migrator** (`DATABASE_MIGRATE_URL`): owns the schema; used only by the release pipeline to run `prisma migrate deploy`.
- **App** (`DATABASE_URL`): `SELECT, INSERT, UPDATE, DELETE` on tables, `USAGE` on sequences. It can't drop the triggers that keep the ledger, audit log and placements permanent.

```sql
CREATE ROLE mlm_app LOGIN PASSWORD '…';
GRANT USAGE ON SCHEMA public TO mlm_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mlm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mlm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE mlm_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mlm_app;
ALTER DEFAULT PRIVILEGES FOR ROLE mlm_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO mlm_app;
```

## Build

**Container (recommended).** The `Dockerfile` builds two images from the same commit: the web app, and a one-off migration job.

```sh
docker build -t binary-commerce:$(git rev-parse --short HEAD) .
docker build --target migrate -t binary-commerce-migrate:$(git rev-parse --short HEAD) .
docker run --rm -e DATABASE_URL=$DATABASE_MIGRATE_URL binary-commerce-migrate:<sha>   # release step 4
docker run -p 3000:3000 --env-file <secrets> binary-commerce:<sha>                    # runs as a non-root user, with a health check
```

The CI pipeline (`.github/workflows/ci.yml`) runs `scripts/release-check.sh` on every push and pull request and builds both images.

**Without containers:**

```sh
npm ci
npx prisma generate
npm run build
```

The deployable output is `.next/standalone` plus `.next/static` and `public` copied next to it:

```sh
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public 2>/dev/null || true
node .next/standalone/server.js        # listens on $PORT (default 3000)
```

Tag every build with the git commit (for example as the image tag) so a rollback can name the exact previous build.

## First deploy

1. Create the database (PITR on), the bucket (versioning on) and the secrets above.
2. Run migrations as the owner: `DATABASE_URL=$DATABASE_MIGRATE_URL npx prisma migrate deploy`.
3. Create the first super admin and the catalogue defaults: `SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… npx tsx prisma/seed.ts`. It never creates demo members in production.
4. Start the app; `GET /api/health` must return `{"ok":true}`.
5. Sign in as the super admin, set up two-step verification, change the password, then remove `SEED_ADMIN_PASSWORD` from the environment.
6. In Paystack: set the webhook URL to `https://<domain>/api/webhooks/paystack`, and the callback URL to `https://<domain>/checkout/callback`.
7. Create the scheduled jobs (table below).
8. Check *Admin → System health*: every line should be green, and each job should show a recent successful run within its interval.
9. Make one real low-value purchase with a live card, refund it from *Admin → Orders*, and confirm both in the Paystack dashboard.

### Scheduled jobs

POST `https://<domain>/api/cron/<job>` with header `Authorization: Bearer $CRON_SECRET`.

| Job | Schedule (Africa/Lagos) |
| --- | --- |
| `send-emails` | every minute |
| `expire-orders` | every 5 minutes |
| `reconcile-payments`, `seal-audit` | every 10 minutes |
| `mature-orders`, `refresh-prices` | hourly |
| `binary` | daily 00:15 (skips itself while binary pay is off) |
| `reconcile-ledger`, `reconcile-volume`, `cleanup` | daily 02:00–02:20 |
| `reconcile-gateway` | daily 03:00 (Paystack against our records; skipped with the test gateway) |

On Render one scheduler runs `scripts/run-scheduled.mjs` every minute and calls whichever jobs are due (`render.yaml`, `docs/HOSTING.md`).

Jobs are safe to run twice or overlap: each is idempotent and uses database locks (tested in `tests/acceptance.test.ts`, *operations*).

## Releasing a new version

1. **Checks pass.** `scripts/release-check.sh` on the release commit: unit and integration tests, migrations from scratch, production build, secret scan of the browser files, browser tests against the production build, log scan, and a backup-restore test. Its evidence is in `.release-check/`.
2. **Read the migrations** in the release (`git diff <live-tag> -- prisma/migrations`). Any that drop or rename a column or table, or rewrite data, need the two-step approach below.
3. **Back up.** Note the time (PITR point) and take an on-demand snapshot: `pg_dump --format=custom --file=pre-release-<tag>.dump "$DATABASE_MIGRATE_URL"`.
4. **Migrate**, as the owner: `DATABASE_URL=$DATABASE_MIGRATE_URL npx tsx scripts/check-migrations.ts && DATABASE_URL=$DATABASE_MIGRATE_URL npx prisma migrate deploy` (on Render this is the `preDeployCommand`). The check refuses any pending migration that could destroy data unless it carries a written approval line (`docs/RUNBOOKS.md`, section 4). The running version keeps working because migrations only add (see rules).
5. **Deploy** the new build with a rolling restart (instances replaced one at a time, each passing `/api/health` before the next).
6. **Smoke test** (10 minutes): sign in as a member and as an admin; open the shop, a product, the cart; *Admin → System health* all green; Paystack webhook deliveries succeeding in the Paystack dashboard; no new errors in the logs.
7. **Watch for an hour:** payment success rate in Paystack, error rate in the logs, *System health* job runs.

### Migration rules (so the previous version keeps working)

- Migrations are forward-only and never edited once applied anywhere. Prisma checks their checksums.
- A release may only **add**: new tables, nullable columns or columns with defaults, indexes (`CREATE INDEX CONCURRENTLY` for big tables, in a migration of its own), constraints added `NOT VALID` then validated.
- Removing or renaming takes two releases: release 1 stops using the old column (and writes both, if renaming); release 2, after release 1 has been live and stable, drops it.
- Never change the ledger, audit, placement or plan-version triggers to allow updates; a correction is always a new entry.

## Rolling back

Decide within the first hour, with the incident lead. Choose the smallest step that stops the harm.

| Situation | Action |
| --- | --- |
| Something is wrong with money (payments recorded wrongly, commissions miscalculated, withdrawals) | First use the pause switches in *Admin → Emergency operations*: pause checkout, commissions or withdrawals. They take effect immediately on every instance |
| The new version has a bug, data is fine | **Roll back the app**: redeploy the previous build tag. Because migrations only add, the previous version runs on the migrated database. Leave the migration in place |
| A migration failed part-way | `prisma migrate deploy` stops and records the migration as failed; the app keeps running on the old version. Check which statements ran (`\d` in psql), undo them by hand, mark it with `npx prisma migrate resolve --rolled-back <name>`, fix the SQL, test with `scripts/release-check.sh`, and deploy again |
| A migration has to be undone | Write a new migration that reverses it, test it with `scripts/release-check.sh`, and release it. Don't edit or delete applied migrations |
| Data was damaged (bad script, corrupting bug) | Restore into a **new** database at the point before the damage, check it, and switch (*Restore procedure* in `docs/INCIDENT-RESPONSE.md`). Then replay the gap from Paystack and the bank |

After any rollback: record what happened in the incident log, add a test that would have caught it, and lift pause switches only when finance agrees.

### Rollback drill

Once before launch and then every quarter, on a staging copy:

1. Deploy release N, then N+1 (with at least one migration).
2. Roll the app back to N; run the smoke test on the migrated database.
3. Restore the pre-release dump into a scratch database and run `DATABASE_URL=<scratch> npx tsx scripts/verify-restore.ts` (audit chain, wallet ledger and network volume must all check out).
4. Record the times taken.
