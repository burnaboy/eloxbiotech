# Incident response and backup recovery

Who does what when something goes wrong, and how to restore data. Keep a printed or offline copy: during an incident the app itself may be unavailable.

## Roles

| Role | Responsibility |
| --- | --- |
| Incident lead (on-call super admin) | Declares the incident, decides on pausing, keeps the timeline |
| Finance lead | Payments, refunds, withdrawals, bank and Paystack contact |
| Technical lead | Servers, database, code, credentials |
| Communications | Customers, affiliates, regulators (NDPC) |

One person can hold several roles in a small team; the incident lead must be named.

## Severity

| Level | Examples | Response |
| --- | --- | --- |
| SEV1 | Money leaving wrongly, admin account taken over, data breach, audit chain broken, database lost | Start immediately, any hour |
| SEV2 | Payments failing for everyone, webhooks rejected, scheduled jobs down, wallet reconciliation mismatch | Within 1 hour |
| SEV3 | One customer's payment stuck, a single failed refund, slow pages | Next working day |

## First 30 minutes

1. **Write down** the time, what was seen and by whom. Start a timeline document outside the app.
2. **Contain** using *Admin → Emergency operations* (super admin, fresh code):
   - Pause withdrawals if money could be leaving wrongly.
   - Pause commissions if commission amounts look wrong.
   - Pause checkout if payments are being mis-recorded.
   - Sign everyone out if accounts or sessions may be compromised.
   - Remove a compromised admin under *Admin team*, or suspend the member.
3. **Preserve evidence.** Don't delete records; the ledger and audit log can't be edited anyway. Export the audit log for the period (*Audit log → Export CSV*). Note the latest sealed hash shown on the audit page.
4. **Check the system health page** (*Admin → System health*) and *Risk & reconciliation* (run both checks).

## Playbooks

### Suspected admin or member account takeover
1. Suspend the account; sign it out everywhere.
2. Super admin resets its two-step verification after confirming identity out of band.
3. Review the audit log filtered by that actor id; reverse any harmful actions with documented corrections (never edits).
4. If a bank account was changed, the 24-hour cooling-off should have held withdrawals; check *Withdrawals* for anything pending to that account.

### Withdrawal sent wrongly or twice
1. Pause withdrawals.
2. Compare *Reports → Payout reconciliation* with the bank statement.
3. Contact the bank for a recall. Record the outcome as settlement evidence or a failure.
4. If money can't be recovered, record a wallet correction with the reason and incident number.

### Forged or suspicious payment events
1. Webhooks are verified and re-checked with Paystack, so a forged event should show as rejected in the webhook log. Check *Risk & reconciliation → Payment issues*.
2. Rotate the Paystack secret key if it might have leaked (Paystack dashboard), update `PAYSTACK_SECRET_KEY`, redeploy.
3. The reconcile job re-verifies pending payments every 10 minutes; run it manually if needed.

### Secret leaked (API key, database password, encryption key)
1. Rotate the secret at the provider; update the hosting secret store; redeploy.
2. Database password: create a new app-role password, update `DATABASE_URL`, then revoke the old one.
3. `APP_ENCRYPTION_KEY`: treat bank numbers as exposed. Generate a new key, run a re-encryption script (old key → new key), inform affected members, and watch for account-change attempts.
4. `CRON_SECRET`: rotate; check the job log for unexpected runs.

### Audit chain reported broken
1. SEV1. Don't run further admin actions until reviewed.
2. The audit page shows the first broken record. Compare with the last externally recorded hash (monthly finance pack).
3. Restore the audit table from backup into a separate database and diff to find what changed; identify who had database owner access.

### Personal data breach
Under the Nigeria Data Protection Act 2023, notify the NDPC within 72 hours of becoming aware of a breach likely to risk people's rights, and tell affected people without undue delay when the risk is high. Record what data, how many people, and what was done.

## After the incident

Within 5 working days: a short write-up (timeline, cause, impact, what fixed it, what changes prevent it), shared with the team. Lift pause switches only when the lead and finance agree. Add a test for the failure where possible.

## Backups

| What | How | Retention |
| --- | --- | --- |
| Postgres | Managed point-in-time recovery (continuous WAL) **and** a nightly `pg_dump -Fc` to a separate account or region, encrypted | PITR 7 days; nightly 35 days; monthly 12 months |
| Uploaded images (S3) | Bucket versioning on; lifecycle keeps old versions 30 days | 30 days |
| `APP_ENCRYPTION_KEY` and other secrets | In the hosting secret manager **and** an offline sealed copy held by two directors | Until rotated |
| Code and migrations | Git repository | Permanent |

Without the encryption key, restored bank account numbers can't be read; members would need to re-enter them.

Nightly dump example (run from a machine with network access to the database, using a read-only role):

```sh
pg_dump --format=custom --no-owner --file="mlm-$(date +%F).dump" "$BACKUP_DATABASE_URL"
gpg --encrypt --recipient backups@yourcompany "mlm-$(date +%F).dump"
```

## Restore procedure

1. **Decide the restore point.** For data loss, the moment before the bad change (from the audit log time). For a full outage, the latest.
2. **Restore into a new database**, never over the live one:
   - Managed PITR: create a new instance at the chosen time.
   - From a dump: `createdb mlm_restore && pg_restore --no-owner --dbname=mlm_restore mlm-YYYY-MM-DD.dump`
3. **Apply migrations** that came after the backup: `DATABASE_URL=… npx prisma migrate deploy`.
4. **Check it** against the restored data before switching:
   - *Audit log → Verify now* (chain intact).
   - *Risk & reconciliation → Check wallets* and *Check network volume* (no problems).
   - Spot-check recent orders and withdrawals against Paystack and the bank.
5. **Reconcile the gap** between the restore point and now: payments and refunds from the Paystack dashboard (the reconcile job re-verifies pending payments; Paystack can resend webhooks), and withdrawals from the bank statement. Record anything missing through the normal admin screens so it lands in the ledger and audit log.
6. **Switch** `DATABASE_URL` to the restored database with checkout and withdrawals paused; unpause after the checks pass.

## Restore drill

Every quarter, restore the latest nightly dump into a scratch database, run step 4, and record how long it took. Target: restore within 4 hours (RTO) losing at most 15 minutes of data with PITR (RPO), or 24 hours from nightly dumps alone.
