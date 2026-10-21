# Commands

Exact commands for each stage, run from the repository root. Needs Node 22, npm, and PostgreSQL 16 (or Docker to run it).

## 1. Local development

```sh
# PostgreSQL 16 in Docker (skip if you have a local PostgreSQL with a mlm/mlm user)
docker run -d --name mlm-db -p 5432:5432 \
  -e POSTGRES_USER=mlm -e POSTGRES_PASSWORD=mlm -e POSTGRES_DB=mlm postgres:16

cp .env.example .env
# Put a fresh key into .env as APP_ENCRYPTION_KEY:
openssl rand -base64 32

npm ci
npx prisma migrate deploy
SEED_ADMIN_PASSWORD='choose-a-password' SEED_DEMO=1 npm run seed
npm run dev                      # http://localhost:3000
```

- Admin: `admin@eloxbiotech.local` with the password you chose; two-step setup is required on first visit to `/admin`.
- Demo members (development fixtures, password `Password123`): `ada@demo.local` (affiliate), `bayo@demo.local`, `chi@demo.local`, `dami@demo.local` (customer).
- Payments go through the built-in simulated gateway (`PAYMENT_PROVIDER=test`), which works only in development, tests and staging rehearsals. To try Paystack's test mode, set `PAYMENT_PROVIDER=paystack` and an `sk_test_…` key in `.env`.
- Scheduled jobs locally, in a second terminal: `APP_URL=http://localhost:3000 CRON_SECRET=dev-only-cron-secret node scripts/run-scheduled.mjs`

## 2. Database migrations

```sh
# Apply all migrations (development, CI, staging, production)
npx prisma migrate deploy

# Check pending migrations for anything that could destroy data (also runs before every Render deploy)
npx tsx scripts/check-migrations.ts

# Create a new migration after editing prisma/schema.prisma (development only)
npx prisma migrate dev --name describe_the_change

# Status
npx prisma migrate status
```

In production, run migrations with the database owner's URL: `DATABASE_URL="$DATABASE_MIGRATE_URL" npx prisma migrate deploy`. Back up first (`docs/DEPLOYMENT.md`, Releasing).

## 3. Tests

```sh
# One-time: test databases (same user as DATABASE_URL)
createdb -h localhost -U mlm mlm_test
createdb -h localhost -U mlm mlm_e2e

npm run typecheck                # TypeScript
npm test                         # unit and integration tests (Vitest, against mlm_test)

npm run build                    # browser tests run against the production build
npm run test:e2e                 # Playwright (Chromium), against mlm_e2e on port 3100

scripts/release-check.sh         # everything, as required before a release (evidence in .release-check/)
```

`scripts/release-check.sh` expects `psql`, `pg_dump` and `pg_restore` (PostgreSQL 16 client) and the database user to be able to create databases.

## 4. Production build

```sh
npm ci
npx prisma generate
npm run build
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public 2>/dev/null || true
NODE_ENV=production PORT=3000 node .next/standalone/server.js
```

Or as containers:

```sh
docker build -t elox-biotech:$(git rev-parse --short HEAD) .
docker build --target migrate -t elox-biotech-migrate:$(git rev-parse --short HEAD) .
```

Production needs the variables listed in `docs/DEPLOYMENT.md` (Environment variables); the app refuses to start a payment with missing or wrong-mode keys.

## 5. Deployment (Render)

**Not done yet: needs Dee's go-ahead.** Nothing has been pushed or deployed. When approved:

```sh
# 1. Put the code on GitHub (repository to be created with Dee's approval)
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin main
git push origin main:production      # the production service deploys from this branch
```

2. In Render: *New → Blueprint*, choose the repository. Render reads `render.yaml` and creates staging (`elox-staging-*`) and production (`elox-prod-*`) web services, schedulers and databases in Frankfurt.
3. Fill in each `sync: false` secret in the Render dashboard. Use **test** Paystack keys on both environments. Leave `LIVE_PAYMENTS_APPROVED=false`.
4. First super admin, from the web service's *Shell*:

   ```sh
   SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='…' npx tsx prisma/seed.ts
   # staging only, for sample products to test with:
   SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='…' SEED_SAMPLE_PRODUCTS=1 npx tsx prisma/seed.ts
   ```

5. Check health:

   ```sh
   curl -s https://<domain>/api/health
   curl -s -H "Authorization: Bearer $MONITOR_TOKEN" https://<domain>/api/health/status
   ```

6. Follow the go-live checklist in `docs/HOSTING.md`. Every push to `main` deploys staging once CI passes. Production deploys only when someone pushes to `production` and starts the deploy by hand. Live payments stay off until written approval, then `LIVE_PAYMENTS_APPROVED=true` with a live key, set by the business in production only.

Rollback: in Render, *Deploys → Rollback* to the previous deploy (`docs/DEPLOYMENT.md`, Rolling back).
