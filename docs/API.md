# API reference

Binary Commerce has no public JSON API for browsers or third parties. The website talks to the server through **Next.js server actions** (form posts handled on the server), and a small set of **HTTP endpoints** exists for Paystack, the scheduler, monitoring, file downloads and referral links. Both are listed here.

All endpoints are served from `APP_URL`. Responses are JSON unless stated. Times are ISO 8601 (UTC); money is in kobo (integer, ₦1 = 100).

## HTTP endpoints

| Method and path | Caller | Auth |
| --- | --- | --- |
| `POST /api/webhooks/paystack` | Paystack | `x-paystack-signature` (HMAC-SHA512 of the raw body with the secret key) |
| `POST /api/webhooks/test` | Built-in test gateway (development, staging rehearsal) | `x-test-signature` (HMAC with `TEST_PAYMENT_SECRET`); refused in production builds unless `ALLOW_TEST_PAYMENTS=true`, and always refused when `APP_ENV=production` |
| `POST /api/cron/{job}` | Scheduler | `Authorization: Bearer $CRON_SECRET` |
| `GET /api/health` | Load balancer, container | None |
| `GET /api/health/status` | Uptime monitor | `Authorization: Bearer $MONITOR_TOKEN` |
| `GET /r/{code}` | Anyone (referral link) | None |
| `GET /admin/export/{report}` | Admin, from the admin area | Session, report permission, fresh two-step code |
| `GET /admin/payouts/batches/{id}/export` | Admin (withdrawals) | Session, `PAYOUTS` permission, fresh two-step code |
| `GET /media/{key}` | Browsers (images, local storage only) | None |

### `POST /api/webhooks/{provider}`

Receives payment events. The raw body is read once, its signature checked, and for Paystack every `charge.success` is **re-verified** with `GET https://api.paystack.co/transaction/verify/{reference}` before anything is recorded; the webhook body itself is never trusted for amounts.

| Paystack event | Effect |
| --- | --- |
| `charge.success` | After verification: amount and currency must match the payment attempt; the order becomes paid; commission and volume are created as pending |
| `refund.pending`, `refund.processing`, `refund.processed`, `refund.failed`, `refund.needs-attention` | Updates the matching refund; a refund made in the Paystack dashboard is recorded once |
| `charge.dispute.create` | Marks the order disputed; its commissions can't mature |
| `charge.dispute.resolve` | Won: commissions continue. Lost: treated as a full refund (reversals) |
| anything else | Ignored, `200 {"ok":true,"ignored":true}` |

Responses:

| Status | Body | Meaning |
| --- | --- | --- |
| 200 | `{"ok":true,"result":"paid"}` (or `duplicate`, `failed`, `amount_mismatch`, `refund_recorded`, …) | Processed. Repeats of the same event return `duplicate` and change nothing |
| 200 | `{"ok":true,"ignored":true}` | Event type not used |
| 401 | `{"error":"invalid signature"}` | Signature missing or wrong. Nothing recorded |
| 404 | `{"error":"unknown provider"}` | Path isn't `paystack` (or `test` where allowed) |
| 413 | `{"error":"too large"}` | Body over 1 MB |
| 500 | `{"error":"temporary failure"}` | Nothing saved; Paystack retries later |

### `POST /api/cron/{job}`

Runs one scheduled job. Each run is recorded for *System health*. Jobs are idempotent: running one twice, or two at once, is safe.

| Job | Response (200) |
| --- | --- |
| `send-emails` | `{"processed": n}` emails sent |
| `expire-orders` | `{"expired": n}` unpaid orders cancelled, stock returned |
| `reconcile-payments` | Pending payments re-verified with the gateway |
| `seal-audit` | Audit records added to the hash chain |
| `mature-orders` | `{"matured": n}` orders whose commissions became available |
| `refresh-prices` | `{"changed": n}` sale prices started or ended |
| `binary` | Binary pairing for the previous Lagos day; `?period=YYYY-MM-DD` for a specific day. Skipped (200) while binary pay is off |
| `reconcile-ledger` | Wallet ledger check; mismatches are logged and shown on *System health* |
| `reconcile-volume` | `{"nodes", "orders", "issues"}` network volume check |
| `reconcile-gateway` | `{"gateway", "recorded", "problems"}` Paystack against recorded payments (skipped with the test gateway) |
| `cleanup` | `{"sessions", "loginAttempts"}` expired rows removed |

Errors: `401 {"error":"unauthorized"}` without the right bearer token; `404` for an unknown job; `500 {"error": "<message>"}` when the job failed (recorded, logged, and shown on *System health*).

### `GET /api/health`

`200 {"ok":true}` when the app can query the database, `503 {"ok":false}` otherwise. Reveals nothing else.

### `GET /api/health/status`

```json
{
  "status": "ok | warn | fail",
  "checkedAt": "2026-10-21T07:00:00.000Z",
  "checks": [{ "name": "Database", "level": "ok", "detail": "Reachable, 3 ms" }],
  "jobs": [{ "job": "send-emails", "level": "ok", "lastSuccess": "2026-10-21T06:59:00.000Z", "everyMinutes": 1 }],
  "paused": { "checkout": false, "commissions": false, "withdrawals": false }
}
```

`200` unless something failed, then `503`. `401` without the right token. Configuration checks say only whether a setting is present and its mode (for example "secret key test mode"), never a value.

### `GET /r/{code}`

Referral link. Optional `?leg=LEFT|RIGHT` (preferred side) and `?to=/path` (same-site page to land on). Sets `ref` and `ref_leg` cookies (HttpOnly, 30 days) and redirects. The sponsor is applied when the visitor registers.

### `GET /admin/export/{report}`

CSV download (UTF-8 with BOM, CRLF; cells that could run as spreadsheet formulas are prefixed with `'`). Must be opened from the admin area (`Sec-Fetch-Site` same-origin), by an admin with the report's permission and a two-step code from the last 10 minutes. Limited to 30 downloads an hour per admin and 50,000 rows each. Each download is written to the audit log.

| Report | Permission | Filters |
| --- | --- | --- |
| `orders` | ORDERS | `from`, `to` (YYYY-MM-DD, Lagos days), `q` (order number or email), `status` |
| `members` | MEMBERS | `from`, `to`, `q` (email, name, referral code) |
| `commissions` | COMMISSIONS | `from`, `to`, `status` |
| `ledger` | COMMISSIONS | `from`, `to`, `type`, `bucket`, `member` |
| `payouts` | PAYOUTS | `from`, `to`, `status` |
| `audit` | AUDIT | `from`, `to`, `q` (action, entity id or actor id) |
| `revenue` | ORDERS | `from`, `to`, `by=day|month` |
| `attribution` | COMMISSIONS | `from`, `to`, `q` |
| `payout-reconciliation` | PAYOUTS | `from`, `to` |

Responses: `200 text/csv`, a redirect to sign-in or to `/admin/verify` for a fresh code, `403` from another site, `404` unknown report, `429` too many exports.

### `GET /admin/payouts/batches/{id}/export`

The bank transfer file for a withdrawal batch (CSV without BOM for bank portals: account name, bank code, full account number decrypted for this file only, amount in naira, reference). Same protections as above; each download is audited.

### `GET /media/{key}`

Only with `STORAGE_DRIVER=local`. Serves re-encoded `.webp` product images with `Content-Security-Policy: default-src 'none'; sandbox`. In production images come from the bucket's public URL instead.

## Server actions

Every page form posts to a server action: a function that runs on the server, checks the session, validates input with zod, and redirects back with a message. They aren't a stable API for other programs (Next.js identifies them with build-specific ids), and they reject calls from other origins.

| Area | Actions | Who | Notes |
| --- | --- | --- | --- |
| Sign-in (`src/app/(auth)/actions.ts`) | `registerAction`, `loginAction`, `verifyCodeAction`, `logoutAction`, `forgotPasswordAction`, `resetPasswordAction` | Anyone | Sign-up limited per IP; sign-in locked after repeated failures; two-step code when enabled |
| Shop (`src/app/(shop)/actions.ts`) | `addToCartAction`, `setQuantityAction`, `applyDiscountAction`, `removeDiscountAction`, `checkoutAction`, `payOrderAction`, `cancelOrderAction`, `requestReturnAction` | Signed-in members; checkout needs a confirmed email | Prices and totals always from the database; checkout idempotent by key; rate limited |
| Account (`src/app/account/actions.ts`) | `updateProfileAction`, `changePasswordAction`, `saveAddressAction`, `deleteAddressAction`, `startMfaAction`, `confirmMfaAction`, `disableMfaAction`, `resendVerificationAction`, `savePrefsAction` | The member | Password and two-step changes rate limited |
| Affiliate (`src/app/dashboard/actions.ts`) | `joinAction`, `setDefaultLegAction`, `saveAccountAction`, `removeAccountAction`, `payoutAction`, `cancelPayoutAction` | The member (affiliate) | Bank accounts verified by name, 24-hour cooling-off; one open withdrawal |
| Support (`src/app/support/actions.ts`) | `openTicketAction`, `replyTicketAction` | The member | Rate limited |
| Admin (`src/app/admin/actions.ts`) | 47 actions: products, stock, images, categories, orders, refunds, returns, members, commissions, wallet corrections, withdrawals, settings, plan, network placement, admin team, emergency switches, audit | Admins with the named permission; some super admin only | Each starts with the permission check (tested for every action). Money and network steps need a fresh two-step code, a reason and a typed confirmation, and are audited |

Rate limits (`src/lib/rate-limit.ts`): register 5/hour per IP; discount codes 10/15 min; checkout 20/15 min; withdrawal requests 5/hour; bank account changes 5/hour; password changes 5/15 min; two-step changes 5/15 min; support tickets 10/hour; replies 30/hour; exports 30/hour.

## Outbound calls

| To | When |
| --- | --- |
| `api.paystack.co` `/transaction/initialize`, `/transaction/verify/{ref}`, `/transaction` (list), `/refund`, `/bank`, `/bank/resolve` | Checkout, verification (retried on network errors), daily reconciliation (read-only), refunds (never retried automatically), bank list and account-name checks |
| S3-compatible storage | Image upload and delete |
| Email provider | From the outbox (none connected yet) |
| `ERROR_ALERT_WEBHOOK` | One scrubbed message per error type per 5 minutes |
