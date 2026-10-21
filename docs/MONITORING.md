# Monitoring and alerting

What to watch once the shop is live, and when someone should be woken up. Set these up with the host's tools and any uptime monitor (Better Stack, UptimeRobot, Grafana Cloud and similar all work).

## Health endpoints

| Endpoint | Auth | Use |
| --- | --- | --- |
| `GET /api/health` | none | Load balancer and container health check. `200 {"ok":true}` when the app can reach the database, else `503`. Says nothing else |
| `GET /api/health/status` | `Authorization: Bearer $MONITOR_TOKEN` | For the external monitor. JSON with an overall `status` (`ok`, `warn`, `fail`), every check from *Admin → System health*, each scheduled job's last success, and the pause switches. `503` when anything has failed. Never contains secrets |

`MONITOR_TOKEN` is separate from `CRON_SECRET` so the monitoring service can read status but can't run jobs.

## Alerts

| Alert | Condition | Severity (see `INCIDENT-RESPONSE.md`) |
| --- | --- | --- |
| Site down | `/api/health` not 200 for 2 minutes from two regions | SEV1 |
| Health failing | `/api/health/status` returns 503 (`status: "fail"`) twice in a row, 5 minutes apart. Covers: database, failed migration, missing secrets, a live Paystack key without approval, broken audit chain, wallet, volume or Paystack reconciliation mismatch, any scheduled job whose last run failed | SEV1 for audit chain or reconciliation, otherwise SEV2 |
| Health warning | `status: "warn"` for over 2 hours (late jobs, stuck payments or orders, failed refunds, email backlog) | SEV3, working hours |
| Payment errors | Paystack dashboard: webhook delivery failures, or failed transactions above the usual rate | SEV2 |
| Error rate | Over 1% of requests return 5xx for 10 minutes (from the host or load balancer) | SEV2 |
| Database | CPU over 80% for 15 minutes, storage over 80%, replication lag, failed backup | SEV2 (backup failure: SEV2 next morning) |
| Certificate | TLS certificate expires within 14 days | SEV3 |

Send SEV1 and SEV2 to the on-call phone, SEV3 to the team channel.

## Error monitoring

- Every unhandled server error (pages, actions, API routes) is caught by `src/instrumentation.ts` and logged with the route, method and error, in the same scrubbed form as handled errors.
- Set `ERROR_ALERT_WEBHOOK` to a team chat webhook: each kind of error posts one message (at most once per 5 minutes per kind), with the environment name. No request data, personal data or secrets are included.
- A hosted error tracker (Sentry and similar) can be added later through the same `instrumentation.ts` hook if the team wants error grouping and history; it isn't needed to start.

## Logs

- The app writes one JSON object per line to standard output in production: `time`, `level`, `event` and fields. Render keeps 7 days (Hobby) or 14 days (Pro); forward to a log service (Better Stack, Axiom, Grafana Loki) for 30 days and log-based alerts.
- Useful events to filter on: `event:"error"` (any error, with `context`), `cron.done` (each job, with `ms`), `scheduler.run`, `reconcile.ledger.mismatch`, `reconcile.volume.mismatch`, `reconcile.gateway.mismatch`.
- Everything written passes through `scrub()`, which removes passwords, tokens, keys, database URLs, card and account numbers and email addresses. The release check proves no secrets reach the log (`scripts/release-check.sh`, step 5).
- Don't add request-body or header logging at the proxy: it would capture passwords and session cookies.
- Look for: `cron <job>` errors, `paystack` errors, `Failed to find Server Action` (an old browser tab after a deploy; harmless unless it keeps happening).

## Routine checks (people)

| When | Who | What |
| --- | --- | --- |
| Daily | Operations | *System health* all green; *Withdrawals* queue; *Orders* paid but not shipped |
| Weekly | Finance | *Reports → Payout reconciliation* against the bank statement; *Risk & reconciliation* (both checks) |
| Monthly | Finance + super admin | Record the latest sealed audit hash outside the system (finance pack); review the admin team and permissions; export the audit log |
| Quarterly | Technical lead | Restore drill and rollback drill (`DEPLOYMENT.md`); `npm audit`; dependency upgrades |
