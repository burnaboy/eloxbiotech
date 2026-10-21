import { prisma } from "./db";
import { getOps } from "./settings";
import { paystackSecretKey } from "./payments/keys";

/*
 * System health for the admin "System health" page. Configuration checks report only whether a value
 * is set and which mode it is in; no secret, key or part of one is ever returned.
 */

export type Level = "ok" | "warn" | "fail";
export type Check = { name: string; level: Level; detail: string };

/** Scheduled jobs and how often they should run (minutes). A job not seen within twice that is flagged. */
export const JOBS: Record<string, number> = {
  "expire-orders": 5,
  "reconcile-payments": 10,
  "send-emails": 1,
  "seal-audit": 10,
  "mature-orders": 60,
  "refresh-prices": 60,
  "reconcile-ledger": 1440,
  "reconcile-volume": 1440,
  cleanup: 1440,
  binary: 1440,
  "reconcile-gateway": 1440,
};

type JobBeat = { startedAt?: string; okAt?: string; failedAt?: string; error?: string; result?: unknown };

/** Records a scheduled job's start, success or failure, so the health page can show when it last ran. */
export async function recordJob(job: string, patch: JobBeat) {
  if (!(job in JOBS)) return;
  const key = `job:${job}`;
  const cur = (await prisma.setting.findUnique({ where: { key } }))?.value as JobBeat | undefined;
  const value = { ...(cur ?? {}), ...patch } as object;
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function jobStatus(now = new Date()) {
  const rows = await prisma.setting.findMany({ where: { key: { startsWith: "job:" } } });
  const map = new Map(rows.map((r) => [r.key.slice(4), r.value as JobBeat]));
  return Object.entries(JOBS).map(([job, every]) => {
    const b = map.get(job);
    const okAt = b?.okAt ? new Date(b.okAt) : null;
    const failedLast = !!(b?.failedAt && (!okAt || new Date(b.failedAt) > okAt));
    const late = !okAt || now.getTime() - okAt.getTime() > every * 2 * 60e3;
    const level: Level = failedLast ? "fail" : late ? "warn" : "ok";
    return { job, everyMinutes: every, okAt, failedAt: b?.failedAt ? new Date(b.failedAt) : null, error: failedLast ? b?.error ?? "failed" : null, level };
  });
}

function configChecks(): Check[] {
  const env = process.env;
  const prod = env.NODE_ENV === "production";
  const provider = env.PAYMENT_PROVIDER ?? "test";
  const key = env.PAYSTACK_SECRET_KEY ?? "";
  const keyMode = !key ? "not set" : key.startsWith("sk_test_") ? "test mode" : key.startsWith("sk_live_") ? "live mode" : "unrecognised format";
  let keyProblem = "";
  try {
    paystackSecretKey(env);
  } catch (e) {
    keyProblem = e instanceof Error ? e.message : "invalid";
  }
  const encKey = Buffer.from(env.APP_ENCRYPTION_KEY ?? "", "base64").length;
  return [
    {
      name: "Payment provider",
      level: provider === "paystack" ? (keyProblem ? "fail" : "ok") : prod ? "warn" : "ok",
      detail: provider === "paystack" ? `Paystack, secret key ${keyMode}${keyProblem ? `: ${keyProblem}` : ""}` : `Test provider${prod ? " (no real payments are taken)" : ""}`,
    },
    { name: "App URL", level: env.APP_URL ? (prod && !env.APP_URL.startsWith("https://") ? "warn" : "ok") : "fail", detail: env.APP_URL ? (env.APP_URL.startsWith("https://") ? "Set, HTTPS" : "Set, not HTTPS") : "Not set: payment callbacks and email links will break" },
    { name: "Encryption key", level: encKey === 32 ? "ok" : "fail", detail: encKey === 32 ? "Set (256-bit)" : "Missing or wrong length: bank accounts can't be saved" },
    { name: "Monitoring token", level: env.MONITOR_TOKEN ? "ok" : prod ? "warn" : "ok", detail: env.MONITOR_TOKEN ? "Set" : "Not set: the external monitor can't read detailed health" },
    { name: "Scheduled jobs secret", level: env.CRON_SECRET ? "ok" : "fail", detail: env.CRON_SECRET ? "Set" : "Not set: scheduled jobs are refused" },
    { name: "Email", level: (env.EMAIL_PROVIDER ?? "log") === "log" ? (prod ? "warn" : "ok") : "ok", detail: (env.EMAIL_PROVIDER ?? "log") === "log" ? "Not sending: emails are only stored" : `Sending via ${env.EMAIL_PROVIDER}` },
    { name: "File storage", level: (env.STORAGE_DRIVER ?? "local") === "local" && prod ? "warn" : "ok", detail: (env.STORAGE_DRIVER ?? "local") === "local" ? "Local disk" : "Object storage" },
    { name: "Bank account checks", level: (env.PAYOUT_VERIFICATION ?? "manual") === "test" && prod ? "warn" : "ok", detail: `Mode: ${env.PAYOUT_VERIFICATION ?? "manual"}` },
  ];
}

export async function systemHealth() {
  const now = new Date();
  const started = Date.now();
  let dbOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }
  const dbMs = Date.now() - started;
  if (!dbOk) return { checks: [{ name: "Database", level: "fail" as Level, detail: "Not reachable" }], jobs: [], counts: null, ops: null };

  const hourAgo = new Date(now.getTime() - 3600e3);
  const dayAgo = new Date(now.getTime() - 864e5);
  const [migrations, stalePayments, stuckOrders, webhookProblems, unsentEmails, failedEmails, unsealed, lastLedger, lastAudit, lastVolume, failedRefunds, lastGateway, jobs, ops] = await Promise.all([
    prisma.$queryRaw<{ unfinished: bigint }[]>`SELECT COUNT(*) AS unfinished FROM "_prisma_migrations" WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL`.catch(() => [{ unfinished: BigInt(-1) }]),
    prisma.payment.count({ where: { status: "PENDING", createdAt: { lt: hourAgo } } }),
    prisma.order.count({ where: { status: "PAID", paidAt: { lt: new Date(now.getTime() - 3 * 864e5) } } }),
    prisma.webhookEvent.count({ where: { receivedAt: { gte: dayAgo }, result: { in: ["amount_mismatch", "unknown_payment", "extra_payment", "late_payment", "chargeback"] } } }),
    prisma.emailOutbox.count({ where: { sentAt: null, error: null, createdAt: { lt: new Date(now.getTime() - 15 * 60e3) } } }),
    prisma.emailOutbox.count({ where: { sentAt: null, error: { not: null }, createdAt: { gte: dayAgo } } }),
    prisma.auditLog.count({ where: { chainPos: null } }),
    prisma.auditLog.findFirst({ where: { action: "ledger.reconcile" }, orderBy: { seq: "desc" }, select: { createdAt: true, data: true } }),
    prisma.auditLog.findFirst({ where: { action: "audit.verify" }, orderBy: { seq: "desc" }, select: { createdAt: true, data: true } }),
    prisma.auditLog.findFirst({ where: { action: "volume.reconcile" }, orderBy: { seq: "desc" }, select: { createdAt: true, data: true } }),
    prisma.refund.count({ where: { status: "FAILED" } }),
    prisma.auditLog.findFirst({ where: { action: "gateway.reconcile" }, orderBy: { seq: "desc" }, select: { createdAt: true, data: true } }),
    jobStatus(now),
    getOps(),
  ]);
  const ledger = lastLedger?.data as { ok?: boolean; problems?: number } | null;
  const chain = lastAudit?.data as { ok?: boolean } | null;
  const vol = lastVolume?.data as { issueCount?: number; issues?: number } | null;
  const checks: Check[] = [
    { name: "Database", level: dbMs > 1000 ? "warn" : "ok", detail: `Reachable, ${dbMs} ms` },
    { name: "Database migrations", level: Number(migrations[0]?.unfinished ?? 0) === 0 ? "ok" : "fail", detail: Number(migrations[0]?.unfinished ?? 0) === 0 ? "All applied" : "A migration failed or is unfinished" },
    ...configChecks(),
    { name: "Unconfirmed payments", level: stalePayments > 0 ? "warn" : "ok", detail: `${stalePayments} payment attempt(s) pending for over an hour (the reconcile job checks them with the provider)` },
    { name: "Paid orders not yet processed", level: stuckOrders > 0 ? "warn" : "ok", detail: `${stuckOrders} order(s) paid more than 3 days ago and not yet in processing` },
    { name: "Payment events needing attention", level: webhookProblems > 0 ? "warn" : "ok", detail: `${webhookProblems} in the last 24 hours (amount mismatch, unknown or extra payment, chargeback)` },
    { name: "Failed refunds", level: failedRefunds > 0 ? "warn" : "ok", detail: `${failedRefunds} refund(s) refused by the provider, waiting for a retry` },
    { name: "Email queue", level: failedEmails > 0 || unsentEmails > 0 ? "warn" : "ok", detail: `${unsentEmails} waiting over 15 minutes, ${failedEmails} failed today` },
    { name: "Audit chain", level: chain ? (chain.ok ? (unsealed > 500 ? "warn" : "ok") : "fail") : "warn", detail: `${chain ? (chain.ok ? "Intact" : "BROKEN") : "Not verified yet"}; ${unsealed} record(s) waiting to be sealed` },
    { name: "Wallet ledger reconciliation", level: ledger ? (ledger.ok ? "ok" : "fail") : "warn", detail: ledger ? (ledger.ok ? `Balanced at ${lastLedger!.createdAt.toISOString()}` : `${ledger.problems ?? "Some"} problem(s) found`) : "Not run yet" },
    { name: "Volume reconciliation", level: vol ? ((vol.issueCount ?? vol.issues ?? 0) > 0 ? "fail" : "ok") : "warn", detail: vol ? `${vol.issueCount ?? vol.issues ?? 0} issue(s) at last run` : "Not run yet" },
  ];
  const gw = lastGateway?.data as { ok?: boolean; problemCount?: number } | null;
  if (gw || (process.env.PAYMENT_PROVIDER ?? "test") === "paystack") {
    checks.push({ name: "Paystack reconciliation", level: gw ? (gw.ok ? "ok" : "fail") : "warn", detail: gw ? (gw.ok ? `Matches Paystack at ${lastGateway!.createdAt.toISOString()}` : `${gw.problemCount} payment(s) differ from Paystack`) : "Not run yet" });
  }
  if (ops.payoutsPaused) checks.push({ name: "Withdrawals", level: "warn", detail: "Paused by a super administrator" });
  return { checks, jobs, counts: { stalePayments, stuckOrders, webhookProblems, unsealed }, ops };
}
