# Known limitations and production readiness

Assessment as of 21 October 2026, on the code in this repository.

## Verdict

**Ready for a staging pilot in Paystack test mode. Not ready to take real money.**

The software is complete for the scope in the specification and every automated release check passes (`TEST-REPORT.md`). What stands between it and launch is mostly not code: an email provider, the compensation plan's real numbers and legal sign-off, the hosting accounts, a test-mode run against Paystack's own servers, and a penetration test.

## Readiness by area

| Area | Status | Notes |
| --- | --- | --- |
| Shop, catalogue, cart, checkout | Ready for pilot | Server-side prices and totals, stock locking, discounts, VAT, delivery |
| Paystack payments and refunds | Built, tested against recorded Paystack responses | Never called Paystack's servers from this environment. Must pass the staging test-mode run first |
| Affiliate referrals and binary tree | Ready for pilot | Database enforces tree shape |
| Commissions | Built; rates are **placeholders** | Direct commission on retail sales after a return window. Binary (team) pay is built but **off** until the business decides and a lawyer approves |
| Wallet ledger and withdrawals | Ready for pilot | Manual bank batches with evidence; Paystack Transfers deliberately not used |
| Member and admin dashboards | Ready for pilot | |
| Security controls | Ready for pilot | Open items in `SECURITY-CHECKLIST.md` (penetration test, role split, key rotation) |
| Email | **Blocker** | No provider connected. Emails are queued in the database but never sent, so members can't verify email or reset passwords in production |
| Deployment | Code on GitHub, CI passing | Release checks and container builds pass on GitHub Actions (burnaboy/eloxbiotech). Render Blueprint not yet applied |
| Monitoring and backups | Built | Uptime monitor, alert webhook and off-site dumps need accounts |
| Legal and compliance | **Blocker** | Compensation plan, terms and income disclosures need Nigerian legal review (`COMPLIANCE.md`) |

## Launch blockers

1. **Email provider.** Choose one (for example Postmark, Resend, Amazon SES or Mailgun), add the sending code to `src/lib/email.ts`, and verify the domain. Without it, sign-up verification and password reset don't work.
2. **Compensation plan.** Real rates, caps, qualification rules and hold period from the business, entered as a new plan version.
3. **Binary team pay decision.** Whether to switch it on at all, and on what volume (retail-only is the built default). This question is still waiting for an answer.
4. **Legal sign-off** on the plan, terms, refund policy, privacy notice and income disclosures under Nigerian law (FCCPC, NDPA 2023, SEC Nigeria guidance on schemes that reward recruitment).
5. **Staging run in Paystack test mode** with real webhooks, refunds and the daily reconciliation, following the go-live checklist in `HOSTING.md`.
6. **Penetration test** by an outside tester.
7. **Written go-live approval**, then `LIVE_PAYMENTS_APPROVED=true` in production only.

## Known limitations

| # | Limitation | Impact | Plan |
| --- | --- | --- | --- |
| 1 | No email provider | Launch blocker (above) | Connect one |
| 2 | Paystack only tested with recorded responses and the built-in test gateway | Unknown differences in real responses | Staging test-mode run |
| 3 | Render Blueprint not applied yet | First deploy may need small fixes | Apply the Blueprint to staging |
| 4 | Payouts are manual bank batches, not Paystack Transfers | Finance uploads a file and records each transfer reference | Deliberate for a pilot; automate later if volume needs it |
| 5 | Browser tests cover Chromium only (desktop and mobile size); no screen-reader testing | Possible issues in Safari, Firefox or with assistive technology | Manual pass before launch |
| 6 | Restore tested on the test data set (117 rows) only | Larger restores untested | Repeat with a staging copy; quarterly drill |
| 7 | Off-site daily dumps not set up | Recovery limited to the host's window | Set up with the hosting account (`RUNBOOKS.md`) |
| 8 | App and migration database roles not split on Render | The app role could, in theory, drop the immutability triggers | Post-launch hardening (`SECURITY.md`) |
| 9 | Encryption key rotation not scripted | Rotation would need emergency work | Write and rehearse the script |
| 10 | Build-tool advisories (0 critical, 9 high, 3 moderate) | None reachable from a request | Upgrade Next.js 16, Prisma 7, Tailwind 4 as planned changes |
| 11 | Next.js prints its own plain-text error line beside the structured JSON one | Log alerts should key on the JSON `event` field | Accept; no secrets seen in it during tests |
| 12 | Single region (Frankfurt), single web instance at first | A Render outage takes the site down | Acceptable for a pilot; add a second instance when traffic grows |
| 13 | Uploads are admin-only images | No member file uploads (no ID documents, receipts) | Add malware scanning if that changes |
| 14 | No KYC or BVN checks | Payouts rely on bank name matching and manual review | Decide with the lawyer whether KYC is required |
| 15 | Placeholder content: product catalogue, brand, legal page wording | Must be replaced before launch | Business |

## What has been verified, and how

- Every test count and result in `TEST-REPORT.md` comes from a run on this code, with its output kept in `.release-check/`.
- The container images, migrations and the Render deploy steps were run locally (`PHASES.md`, phase 10).
- The full release check and both container builds pass on GitHub Actions. Nothing has been run against Paystack, Render, an email provider or a real bank.
