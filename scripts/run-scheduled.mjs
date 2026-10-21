/**
 * One scheduler entry point for hosts that run a single cron job every minute (render.yaml).
 * Works out which jobs are due this minute (Africa/Lagos time, which has no daylight saving)
 * and calls each one on the app: POST $APP_URL/api/cron/<job> with the CRON_SECRET.
 * Exits non-zero if any job failed, so the host shows the run as failed.
 *
 *   APP_URL=https://… CRON_SECRET=… node scripts/run-scheduled.mjs
 */

/** Same jobs and intervals as docs/DEPLOYMENT.md and src/lib/health.ts. */
export const SCHEDULE = [
  { job: "send-emails", every: 1 },
  { job: "expire-orders", every: 5 },
  { job: "reconcile-payments", every: 10 },
  { job: "seal-audit", every: 10, offset: 5 },
  { job: "mature-orders", every: 60, offset: 2 },
  { job: "refresh-prices", every: 60, offset: 3 },
  { job: "binary", daily: "00:15" },
  { job: "reconcile-ledger", daily: "02:00" },
  { job: "reconcile-volume", daily: "02:10" },
  { job: "cleanup", daily: "02:20" },
  { job: "reconcile-gateway", daily: "03:00" },
];

/** Jobs due in the minute containing `date`. */
export function dueJobs(date = new Date()) {
  const lagos = new Date(date.getTime() + 60 * 60e3); // UTC+1 all year
  const minuteOfDay = lagos.getUTCHours() * 60 + lagos.getUTCMinutes();
  const hhmm = `${String(lagos.getUTCHours()).padStart(2, "0")}:${String(lagos.getUTCMinutes()).padStart(2, "0")}`;
  return SCHEDULE.filter((s) => (s.daily ? s.daily === hhmm : (minuteOfDay - (s.offset ?? 0)) % s.every === 0)).map((s) => s.job);
}

async function main() {
  const base = process.env.APP_URL?.replace(/\/$/, "");
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    console.error(JSON.stringify({ level: "error", event: "scheduler.config", message: "APP_URL and CRON_SECRET must be set" }));
    process.exit(2);
  }
  let failed = 0;
  for (const job of dueJobs()) {
    const started = Date.now();
    try {
      const res = await fetch(`${base}/api/cron/${job}`, { method: "POST", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(240_000) });
      if (!res.ok) failed++;
      console.info(JSON.stringify({ time: new Date().toISOString(), level: res.ok ? "info" : "error", event: "scheduler.run", job, status: res.status, ms: Date.now() - started }));
    } catch (e) {
      failed++;
      console.error(JSON.stringify({ time: new Date().toISOString(), level: "error", event: "scheduler.run", job, error: e instanceof Error ? e.name : "error", ms: Date.now() - started }));
    }
  }
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
