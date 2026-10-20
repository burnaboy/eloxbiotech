import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { systemHealth, type Level } from "@/lib/health";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TBody, THead, Table, Td, Th } from "@/components/ui/table";

export const metadata = { title: "System health" };
export const dynamic = "force-dynamic";

const TONE: Record<Level, "success" | "warning" | "danger"> = { ok: "success", warn: "warning", fail: "danger" };
const WORD: Record<Level, string> = { ok: "OK", warn: "Check", fail: "Problem" };

export default async function Health() {
  await requireAdmin("RISK");
  const h = await systemHealth();
  const fails = h.checks.filter((c) => c.level === "fail").length + h.jobs.filter((j) => j.level === "fail").length;
  const warns = h.checks.filter((c) => c.level === "warn").length + h.jobs.filter((j) => j.level === "warn").length;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">System health</h1>
      <Alert tone={fails ? "error" : warns ? "info" : "success"}>
        {fails ? `${fails} problem(s) need attention.` : warns ? `Running, with ${warns} item(s) to check.` : "Everything is running normally."} Checked {formatDate(new Date())}.
      </Alert>
      <Table>
        <caption className="sr-only">Health checks</caption>
        <THead><tr><Th>Check</Th><Th>Status</Th><Th>Detail</Th></tr></THead>
        <TBody>
          {h.checks.map((c) => (
            <tr key={c.name}>
              <Th scope="row" className="font-medium">{c.name}</Th>
              <Td><Badge tone={TONE[c.level]}>{WORD[c.level]}</Badge></Td>
              <Td className="text-muted-foreground">{c.detail}</Td>
            </tr>
          ))}
        </TBody>
      </Table>
      <Card>
        <CardHeader>
          <CardTitle>Scheduled jobs</CardTitle>
          <CardDescription>Flagged when a job hasn&apos;t succeeded within twice its usual interval. Jobs are started by the server&apos;s scheduler with the scheduled-jobs secret.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <caption className="sr-only">Scheduled jobs</caption>
            <THead><tr><Th>Job</Th><Th>Runs every</Th><Th>Last success</Th><Th>Status</Th></tr></THead>
            <TBody>
              {h.jobs.map((j) => (
                <tr key={j.job}>
                  <Th scope="row" className="font-normal"><code>{j.job}</code></Th>
                  <Td>{j.everyMinutes >= 1440 ? "day" : j.everyMinutes >= 60 ? "hour" : `${j.everyMinutes} min`}</Td>
                  <Td>{j.okAt ? formatDate(j.okAt) : "never"}</Td>
                  <Td><Badge tone={TONE[j.level]}>{j.level === "fail" ? "Failed" : j.level === "warn" ? (j.okAt ? "Late" : "Not run") : "OK"}</Badge>{j.error && <span className="block text-xs text-destructive">{j.error}</span>}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        For details see <Link href="/admin/risk" className="text-primary underline">Risk &amp; reconciliation</Link>, <Link href="/admin/reports?tab=payouts" className="text-primary underline">payout reconciliation</Link> and the <Link href="/admin/audit" className="text-primary underline">audit log</Link>.
        Monitoring services can poll <code>/api/health</code>, which reports only whether the database is reachable.
      </p>
    </>
  );
}
