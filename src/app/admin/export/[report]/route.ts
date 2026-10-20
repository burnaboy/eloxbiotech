import { redirect } from "next/navigation";
import { rateLimit } from "@/lib/rate-limit";
import type { NextRequest } from "next/server";
import { hasRecentStepUp, requireAdmin } from "@/lib/session";
import { REPORTS, buildExport } from "@/lib/exports";
import { csvResponse, sameSiteRequest } from "@/lib/csv";

/** CSV export of an admin list or report. Needs the report's permission and a fresh authenticator code; every download is audited. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  if (!sameSiteRequest(req)) return new Response("Open exports from the admin area.", { status: 403 });
  const { report } = await params;
  const def = REPORTS[report];
  if (!def) return new Response("Unknown report", { status: 404 });
  const admin = await requireAdmin(def.perm);
  const back = req.headers.get("referer");
  const backPath = back && new URL(back).origin === req.nextUrl.origin ? new URL(back).pathname + new URL(back).search : "/admin";
  if (!(await hasRecentStepUp())) redirect(`/admin/verify?next=${encodeURIComponent(backPath)}`);
  try {
    await rateLimit("export", admin.id);
  } catch {
    return new Response("Too many exports. Please wait and try again.", { status: 429 });
  }
  const out = await buildExport(report, req.nextUrl.searchParams, admin.id);
  if (!out) return new Response("Unknown report", { status: 404 });
  return csvResponse(out.filename, out.csv);
}
