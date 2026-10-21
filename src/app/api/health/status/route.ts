import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { systemHealth } from "@/lib/health";
import { logError } from "@/lib/log";

export const dynamic = "force-dynamic";

/**
 * Detailed health for an external monitor (docs/MONITORING.md). Needs "Authorization: Bearer $MONITOR_TOKEN";
 * a separate token from CRON_SECRET, so the monitoring service can read status but can't run jobs.
 * 200 when nothing has failed, 503 when any check or scheduled job has. Never returns secrets.
 */
function authorized(req: NextRequest) {
  const token = process.env.MONITOR_TOKEN;
  if (!token) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${token}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const h = await systemHealth();
    const all = [...h.checks.map((c) => c.level), ...h.jobs.map((j) => j.level)];
    const status = all.includes("fail") ? "fail" : all.includes("warn") ? "warn" : "ok";
    return NextResponse.json(
      {
        status,
        checkedAt: new Date().toISOString(),
        checks: h.checks.map((c) => ({ name: c.name, level: c.level, detail: c.detail })),
        jobs: h.jobs.map((j) => ({ job: j.job, level: j.level, lastSuccess: j.okAt?.toISOString() ?? null, everyMinutes: j.everyMinutes })),
        paused: h.ops ? { checkout: h.ops.checkoutPaused, commissions: h.ops.commissionsPaused, withdrawals: h.ops.payoutsPaused } : null,
      },
      { status: status === "fail" ? 503 : 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    logError("health status", e);
    return NextResponse.json({ status: "fail", error: "health check failed" }, { status: 503 });
  }
}
