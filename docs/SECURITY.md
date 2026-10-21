# Security and threat model

This document describes who might attack Elox BioTech, what they would want, and the controls that stop them. It reflects the code as built; items marked **Open** are known gaps with a plan.

Related: [Incident response and backup recovery](INCIDENT-RESPONSE.md).

## What we protect

| Asset | Why it matters |
| --- | --- |
| Money flows: payments, refunds, commissions, wallet ledger, withdrawals | Direct financial loss; regulatory exposure |
| Bank account details of affiliates | Fraud, redirecting payouts |
| Customer personal data (names, emails, phones, delivery addresses) | NDPA 2023 obligations; trust |
| Compensation plan rules and their history | Every commission must be reproducible and tamper-free |
| Admin accounts and permissions | Highest-impact takeover target |
| Audit log | Evidence for investigations and disputes |
| Inventory | Overselling; fake scarcity |

## Actors and what they might try

**Customers (and anonymous visitors).** Pay less than the price, get goods without paying, reuse discount codes, guess codes, read other people's orders, flood forms, script sign-ups.

**Affiliates.** Earn commission without a real sale (self-purchases, fake customers, paying with a forged reference, refunding after payout), move themselves or others in the tree, withdraw more than they have, withdraw twice, change the bank account of another member, see other members' data.

**Administrators (including a malicious insider).** Mark withdrawals paid without sending money, pay themselves, change the plan quietly, raise their own permissions, export member data, edit or delete the audit trail or the ledger, read full bank account numbers.

**Payment callbacks.** A forged or replayed webhook claiming an order was paid, out-of-order events (a "failed" after a "success"), a different amount or currency, duplicate deliveries.

**External attackers.** Credential stuffing, session theft, XSS, CSRF, SQL injection, SSRF, malicious uploads, dependency exploits, scraping secrets from logs.

## Controls by threat

| Threat | Controls in place | Where |
| --- | --- | --- |
| Broken access control / privilege escalation | Every page and server action checks the session on the server. Admin areas need a named permission (`requireAdmin("ORDERS")` etc.); team, plan, tax and withdrawal-limit settings are super-admin only. Admins must have two-step sign-in. Sensitive actions need a fresh code (10 min). Admins can't approve their own withdrawal or change their own status. There must always be one super admin. | `src/lib/session.ts`, `src/app/admin/actions.ts` (`act`) |
| Insecure direct object references | Member-facing queries always include `userId` of the signed-in member (orders, receipts, tickets, addresses, payouts, returns). Staff need the matching permission to open another member's record. Ids are random (cuid). | `src/app/(shop)/orders`, `src/lib/support.ts`, `src/lib/addresses.ts`, `src/lib/wallet.ts` |
| SQL injection | Prisma query builder everywhere; raw SQL only through tagged templates (`$queryRaw\`…\``), which send values as parameters. No `$queryRawUnsafe` in app code. | all of `src/lib` |
| Cross-site scripting | React escapes all output. The only raw HTML is product JSON-LD with `<` escaped. Content Security Policy with a per-request nonce and `strict-dynamic`, so injected scripts don't run. Uploaded files are re-encoded images served with `sandbox` CSP. | `src/middleware.ts`, `src/app/media` |
| CSRF | Server actions check the Origin header (Next.js). Session cookie is `SameSite=Lax`, `HttpOnly`, `Secure` in production. Export downloads (GET) refuse cross-site requests (`Sec-Fetch-Site`). `form-action` CSP limits where forms can post. | `src/lib/session.ts`, `src/lib/csv.ts` |
| SSRF | The server only calls fixed hosts (Paystack API, the configured S3 endpoint, email provider). No feature fetches a user-supplied URL; the brand logo URL is shown by the browser, never fetched by the server. | `src/lib/payments/paystack.ts`, `src/lib/storage.ts` |
| Authentication weaknesses | Argon2id password hashes (`@node-rs/argon2`; old bcrypt hashes upgraded on sign-in). Constant-time dummy check for unknown emails. TOTP two-step sign-in via the maintained `otpauth` library, codes single-use, recovery codes hashed. Email verification before checkout or withdrawals. Password reset tokens: random, hashed, 30 minutes, single use. | `src/lib/auth.ts`, `src/lib/mfa.ts`, `src/lib/totp.ts` |
| Session theft / fixation | Random 256-bit session token, only its hash stored. New token on every sign-in. Sign-out everywhere (member and admin). Sessions expire; suspended members are signed out. | `src/lib/auth.ts`, `src/lib/session.ts` |
| Brute force / rate-limit bypass | Failed sign-ins, two-step codes and reset requests throttled per account and per IP. Rate limits on sign-up, discount codes, checkout, withdrawal requests, bank account changes, password and two-step changes, support, exports and the contact form, stored in Postgres with a lock so parallel requests can't slip through. Client IP taken from the proxy-added `X-Forwarded-For` entry only (`TRUSTED_PROXY_HOPS`), so forged headers don't create fresh limits. | `src/lib/rate-limit.ts`, `src/lib/session.ts` |
| Payment webhook spoofing | Paystack webhooks verified with HMAC-SHA512 of the raw body in constant time. Every success is re-verified server-side with Paystack before an order is paid. Amount, currency, reference and status must all match. A browser redirect is never treated as proof of payment. | `src/lib/payments/paystack.ts`, `src/lib/payments/service.ts` |
| Duplicate transactions | Unique constraints on payment reference, webhook event id, ledger idempotency key, withdrawal request key and transfer reference. Order row locked while applying an event. Checkout keys make double-submits return the same order. One open withdrawal per member (partial unique index). | Prisma schema, migrations |
| Commission manipulation | Commission only from verified paid orders, on eligible net sales, at the plan version stored on the order. No commission on own purchases, sign-ups or positions. Refunds and chargebacks reverse it. Binary matching stays off until approved. Admin corrections are new ledger entries with a reason, never edits. Plan changes are new immutable versions with a note and typed confirmation. | `src/lib/commissions.ts`, `src/lib/comp-plan.ts`, `src/lib/ledger.ts` |
| Inventory race conditions | Stock reserved with conditional atomic updates inside the order transaction; can't go below zero. Expired checkouts release reservations. | `src/lib/orders.ts`, `src/lib/inventory.ts` |
| Unauthorized placement changes | Placement is permanent; only the system (automatic) or an admin with NETWORK permission, a fresh code, a reason and typed confirmation can place. Every placement is recorded. | `src/lib/tree.ts`, `placeMemberAction` |
| Sensitive data exposure | Bank account numbers encrypted (AES-256-GCM), shown masked; full number only to PAYOUT_DETAILS staff, audited. No BVN or card data collected. Members see only their own downline, with buyer names shortened. Health page reports configuration modes, never values. | `src/lib/payouts/accounts.ts`, `src/lib/health.ts` |
| Insecure file uploads | Admin-only. Content sniffed (JPEG/PNG/WebP), 5 MB and pixel limits, decoded and re-encoded to WebP (drops metadata and payloads), random names, served with `nosniff` and a sandbox CSP. `sharp` kept up to date (0.35.5). | `src/lib/images.ts` |
| Dependency vulnerabilities | `npm audit` checked. See **Open** below for remaining advisories. | `package.json` |
| Secrets leakage | Secrets only in environment variables; never sent to the browser. Test keys enforced outside production. Error logs pass through `logError`, which removes keys, password hashes, tokens, emails and long numbers. Email bodies with reset/verify links are masked in the admin email log. | `src/lib/log.ts` |
| Audit log tampering | Append-only (database trigger blocks update/delete), hash-chained and sealed every 10 minutes; "Verify now" recomputes the chain. Ledger rows are immutable by trigger too. | `src/lib/audit.ts`, migrations |
| Insecure exports | Exports need the area's permission and a fresh code, are rate limited, audited with their filters, exclude bank numbers (except the batch transfer file, PAYOUT_DETAILS only), and neutralise spreadsheet formulas. | `src/lib/exports.ts`, `src/lib/csv.ts` |
| Abuse of payout operations | Funds reserved atomically on request; can't exceed available balance. Review by a different person with PAYOUTS permission and a fresh code. "Paid" needs a unique transfer reference, date and evidence (database CHECK). New or changed bank accounts wait 24 hours and the member is emailed. Shared bank accounts are flagged. Daily wallet reconciliation. | `src/lib/wallet.ts` |
| Transport and headers | HTTPS required in production (HSTS 2 years, `upgrade-insecure-requests`), `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, strict referrer policy, permissions policy. | `next.config.mjs`, `src/middleware.ts` |

## Service credentials

| Credential | Scope | Notes |
| --- | --- | --- |
| `DATABASE_URL` | App role: read/write on app tables only | Use a separate owner role for migrations. The app role must not own tables, so it can't drop the immutability triggers. |
| `PAYSTACK_SECRET_KEY` | Payments and refunds | Test key everywhere except production. Rotate in the Paystack dashboard. Transfers API is not used. |
| `APP_ENCRYPTION_KEY` | Encrypts bank account numbers; HMAC for fingerprints | 32 bytes, base64. Store in the hosting secret manager, back it up separately from the database. |
| `CRON_SECRET` | Calls scheduled jobs | Long random value; rotate if exposed. |
| S3 keys | One bucket, put/get/delete | No list or admin rights. |

## Open items

- **Next.js 15 bundled PostCSS advisories** (moderate/high in `npm audit`). They concern processing attacker-controlled CSS at build time; the app never processes user CSS. Fix: upgrade to Next.js 16 as a planned change with a full test run.
- **Prisma CLI advisories** (`prisma`, `@prisma/config`, `deepmerge-ts`). These affect the migration tool's config loading, not the runtime client, and aren't reachable from requests. Fix: upgrade to Prisma 7 as a planned change.
- **Build-tool advisories** (`npm audit`, 21 October 2026: 0 critical, 9 high, 3 moderate). All are in build or test tooling (Tailwind 3's file watcher and glob libraries, PostCSS inside Next.js's build, Prisma's config loader); none is part of the running server or reachable from a request. Vitest was upgraded to 5 to clear the two critical ones. Remaining fixes need Next.js 16, Prisma 7 and Tailwind 4, planned as separate upgrades (`docs/RUNBOOKS.md`, section 3).
- **Live payments** are refused in code until `LIVE_PAYMENTS_APPROVED=true` is set in production after written go-live approval; staging can only use test keys.
- **Encryption key rotation** is not automated. Rotating `APP_ENCRYPTION_KEY` needs a one-off re-encryption script.
- **Malware scanning** of uploads is not needed while uploads are admin-only images that are re-encoded; revisit if members can upload documents.
- **External penetration test** before go-live.

## Logging rules

Never log passwords, session cookies, API keys, full bank or card numbers, or request bodies. Use `logError(context, error)`. Personal data in logs is limited to ids.
