import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { expireStaleOrders } from "@/lib/orders";
import { reconcilePendingPayments } from "@/lib/payments/service";
import { BinaryDisabledError, matureOrders, runBinary } from "@/lib/commissions";
import { reconcileLedger } from "@/lib/ledger";
import { sealAuditLog } from "@/lib/audit";
import { deliverPendingEmails } from "@/lib/email";
import { prisma } from "@/lib/db";
import { reconcileVolume } from "@/lib/volume";
import { refreshSalePrices } from "@/lib/catalog";
import { recordJob } from "@/lib/health";
import { log, logError } from "@/lib/log";
import { reconcileGateway } from "@/lib/payments/gateway-reconciliation";

/**
 * Scheduled jobs. Call with header "Authorization: Bearer $CRON_SECRET".
 * - expire-orders: every 5 min
 * - reconcile-payments: every 10 min
 * - mature-orders: hourly
 * - binary: daily just after midnight Lagos time (pays the previous day); skipped while binary payouts are off
 * - reconcile-ledger: daily (wallet ledger against commissions and payouts, reports only)
 * - seal-audit: every 10 min (links new audit records into the tamper-evident hash chain)
 * - send-emails: every minute
 * - reconcile-volume: daily (checks network totals against the sales ledger, reports only)
 * - refresh-prices: hourly (sale prices that started or ended, for sorting and filtering)
 * - cleanup: daily (expired sessions, old sign-in attempts)
 */
function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

function lagosDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(d); // YYYY-MM-DD
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { job } = await params;
  await recordJob(job, { startedAt: new Date().toISOString() }).catch(() => undefined);
  const started = Date.now();
  try {
    const res = await runJob(job, req);
    if (res.status < 400) await recordJob(job, { okAt: new Date().toISOString() }).catch(() => undefined);
    log(res.status < 400 ? "info" : "warn", "cron.done", { job, status: res.status, ms: Date.now() - started });
    return res;
  } catch (e) {
    logError(`cron ${job}`, e, { job, ms: Date.now() - started });
    const message = e instanceof Error ? e.message : "failed";
    await recordJob(job, { failedAt: new Date().toISOString(), error: message.slice(0, 300) }).catch(() => undefined);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function runJob(job: string, req: NextRequest): Promise<NextResponse> {
  {
    switch (job) {
      case "expire-orders":
        return NextResponse.json({ expired: await expireStaleOrders() });
      case "reconcile-payments":
        return NextResponse.json(await reconcilePendingPayments());
      case "send-emails":
        return NextResponse.json({ processed: await deliverPendingEmails() });
      case "cleanup": {
        const now = new Date();
        const [s, a] = await Promise.all([
          prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
          prisma.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 864e5) } } }),
        ]);
        return NextResponse.json({ sessions: s.count, loginAttempts: a.count });
      }
      case "reconcile-volume": {
        const r = await reconcileVolume(null);
        if (r.issueCount > 0) log("error", "reconcile.volume.mismatch", { issues: r.issueCount });
        return NextResponse.json({ nodes: r.nodes, orders: r.orders, issues: r.issueCount });
      }
      case "reconcile-gateway": {
        // Paystack's successful transactions for the last two days against the payments recorded here.
        if ((process.env.PAYMENT_PROVIDER ?? "test") !== "paystack") return NextResponse.json({ skipped: "not using Paystack" });
        const to = new Date();
        const r = await reconcileGateway(new Date(to.getTime() - 2 * 864e5), to);
        if (!r.ok) log("error", "reconcile.gateway.mismatch", { problems: r.problemCount });
        return NextResponse.json({ gateway: r.gatewayCount, recorded: r.recordedCount, problems: r.problemCount });
      }
      case "refresh-prices":
        return NextResponse.json({ changed: await refreshSalePrices(prisma) });
      case "mature-orders":
        return NextResponse.json({ matured: await matureOrders() });
      case "binary": {
        const period = new URL(req.url).searchParams.get("period") ?? lagosDate(-1);
        try {
          const run = await runBinary(period, null);
          return NextResponse.json({ period, pairs: run.pairsPaid, amountMinor: run.amountMinor });
        } catch (e) {
          if (e instanceof BinaryDisabledError) return NextResponse.json({ period, skipped: "binary payouts are switched off in the plan" });
          throw e;
        }
      }
      case "reconcile-ledger": {
        const r = await reconcileLedger();
        if (!r.ok) log("error", "reconcile.ledger.mismatch", { problems: r.problems.length });
        return NextResponse.json({ ok: r.ok, problems: r.problems.length, members: r.members });
      }
      case "seal-audit":
        return NextResponse.json({ sealed: await sealAuditLog() });
      default:
        return NextResponse.json({ error: "unknown job" }, { status: 404 });
    }
  }
}
