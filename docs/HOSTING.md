# Hosting plan: staging and production

**Recommendation:** Render, with a managed PostgreSQL database, in the Frankfurt region. Everything is described in `render.yaml` (a Render "Blueprint"), so both environments are created the same way and can be recreated from the repository.

Why Render to start:
- One provider for the app, the database, scheduled jobs, HTTPS certificates and secrets. No servers or Kubernetes to look after.
- Managed PostgreSQL with point-in-time recovery on paid instances (3 days on the free Hobby workspace, 7 days on Pro) and on-demand exports.
- Deploys from GitHub; staging can wait for CI to pass before deploying.
- Frankfurt is the closest region to Nigeria that Render offers (the others are in the US and Singapore).

The app is a plain Node/Docker application, so it can move later (Fly.io, Railway, DigitalOcean App Platform, or AWS) without code changes: `Dockerfile` and `docs/DEPLOYMENT.md` cover any host.

## What gets created

| | Staging | Production |
| --- | --- | --- |
| Purpose | Rehearse every release; Paystack **test mode** only | Real customers |
| Branch and deploys | `main`, automatically once CI passes | `production`, by hand after the release checklist |
| Web service | `bc-staging-web` (0.5 CPU, 512 MB) | `bc-prod-web` (1 CPU, 2 GB) |
| Scheduler | `bc-staging-scheduler`: every minute runs `scripts/run-scheduled.mjs`, which calls the jobs that are due | `bc-prod-scheduler`, same |
| Database | `bc-staging-db`, PostgreSQL 16, smallest paid size | `bc-prod-db`, PostgreSQL 16, 1 GB RAM |
| Database network | Private only (no public access) | Private only |
| Paystack | `sk_test_…`; the app refuses a live key here | `sk_test_…` until go-live, then `sk_live_…` with `LIVE_PAYMENTS_APPROVED=true` |
| Domain | `staging.<your-domain>` | `<your-domain>` and `www.` |

Product images go to an S3-compatible bucket outside Render (for example Cloudflare R2), one bucket per environment.

### Approximate monthly cost

From Render's published prices (checked 21 October 2026, US dollars, before tax; confirm on render.com/pricing before buying):

| Item | Price |
| --- | --- |
| Production web, `1c-2g` | $25 |
| Staging web, `0.5c-512mb` | $7 |
| Production database, `0.5c-1g`, 1 GB storage included | $19 |
| Staging database, `0.1c-256mb` | $6 |
| Two schedulers, billed per second of run time (a few seconds a minute) | about $1–2 |
| Extra database storage | $0.30 per GB per month |
| Workspace: Hobby (1 person, 2 environments, 3-day recovery) | $0 |
| *or* Pro (team seats, 7-day recovery, longer logs) | $25 |

**About $58 a month on Hobby, or $83 on Pro,** plus image storage and an email service (both usually free or a few dollars at this size). Upgrade to Pro once more than one person needs dashboard access, or when 7-day recovery is wanted.

## Setting it up

1. Push the repository to GitHub and create a `production` branch from `main`.
2. In Render: *New → Blueprint*, choose the repository. Render reads `render.yaml` and asks for each secret marked `sync: false` (Paystack test key, bucket keys, `APP_URL`, the optional error webhook). Use **test** Paystack keys in both environments.
3. Render generates `APP_ENCRYPTION_KEY`, `CRON_SECRET` and `MONITOR_TOKEN`. **Copy each environment's `APP_ENCRYPTION_KEY` to the offline backup now** (two sealed copies): without it, saved bank account numbers can't be read after a restore.
4. Custom domains: add them on each web service; Render issues and renews the HTTPS certificates. Point DNS as Render shows. Then set `APP_URL` to the `https://` address and redeploy.
5. First super admin: open the web service's *Shell* and run `SEED_ADMIN_EMAIL=you@… SEED_ADMIN_PASSWORD='…' npx tsx prisma/seed.ts`. Sign in, set up two-step verification, change the password.
6. Paystack dashboard (test mode first): webhook URL `https://<domain>/api/webhooks/paystack`, callback URL `https://<domain>/checkout/callback`.
7. Monitoring: point the uptime monitor and alerts at the two health endpoints (`docs/MONITORING.md`), and set `ERROR_ALERT_WEBHOOK` to a team chat webhook.
8. Go through the go-live checklist below on staging, then on production.

## HTTPS and secrets

- HTTPS: certificates are issued and renewed by Render. The app sends `Strict-Transport-Security` (2 years, subdomains) and upgrades insecure requests when `APP_URL` is `https`. Session cookies are `Secure` and `HttpOnly`. Check after setup that `http://` addresses redirect to `https://`.
- Secrets live only in Render's environment settings, visible only to workspace members. Nothing secret is in `render.yaml`, the repository, the build output or the logs (checked by `scripts/release-check.sh`).
- Database: private network only (`ipAllowList: []`). For a manual dump or a restore check, add your IP for the duration and remove it afterwards.
- The Render database user owns the schema and is used for both migrations and the app. Hardening step once live: create a separate app role without DDL rights (`docs/DEPLOYMENT.md`, *Database roles*) and use it for `DATABASE_URL`, keeping the owner URL only for migrations.

## Go-live checklist (test mode first)

Do these on **staging** with Paystack test keys and test cards, then repeat on **production** while still in test mode. Live keys come last, and only with written approval.

1. All release checks pass on the commit being deployed (CI green).
2. Buy as a referred customer with a Paystack [test card](https://paystack.com/docs/payments/test-payments/); check the order is paid, stock went down, the sponsor has a pending commission.
3. Try a declined test card: the order stays unpaid and no commission appears.
4. Refund it from the admin: Paystack shows the refund; the commission is reversed.
5. Run `mature-orders` early on staging (or set a 0-day return window there) and check the commission becomes available.
6. Save a payout bank account with Paystack's test account lookup; request a withdrawal; approve; create a batch; download the transfer file. **Do not send money.** Record it as paid with a test reference and "staging test" as evidence; check the wallet and *Payout reconciliation*.
7. Fail and requeue a test withdrawal; check the funds return.
8. *System health* all green; *Paystack reconciliation* matches; the uptime monitor and error alert reach the team (trigger a test alert).
9. Restore drill on staging (`docs/DEPLOYMENT.md`, *Rollback drill*).
10. Legal sign-off on the plan and policies (`docs/COMPLIANCE.md`), and an email provider connected.
11. **Go-live approval in writing** from the business owner. Only then, in production: replace the Paystack key with `sk_live_…`, set `LIVE_PAYMENTS_APPROVED=true`, update the Paystack live-mode webhook and callback URLs, redeploy.
12. One real low-value purchase and refund in production; confirm in Paystack.

The app never sends payouts itself: withdrawals are paid by the finance team through the bank, and the app only records them with evidence. Nothing in this setup can move money without a person doing it at the bank.
