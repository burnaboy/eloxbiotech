import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { expireStaleOrders, reconcilePendingPayments } from "@/lib/orders";
import { matureOrders, runBinary } from "@/lib/commissions";
import { deliverPendingEmails } from "@/lib/email";
import { prisma } from "@/lib/db";

/**
 * Scheduled jobs. Call with header "Authorization: Bearer $CRON_SECRET".
 * - expire-orders: every 5 min
 * - reconcile-payments: every 10 min
 * - mature-orders: hourly
 * - binary: daily just after midnight Lagos time (pays the previous day)
 * - send-emails: every minute
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
  try {
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
      case "mature-orders":
        return NextResponse.json({ matured: await matureOrders() });
      case "binary": {
        const period = new URL(req.url).searchParams.get("period") ?? lagosDate(-1);
        const run = await runBinary(period, null);
        return NextResponse.json({ period, pairs: run.pairsPaid, amountMinor: run.amountMinor });
      }
      default:
        return NextResponse.json({ error: "unknown job" }, { status: 404 });
    }
  } catch (e) {
    console.error(`cron ${job} failed`, e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
