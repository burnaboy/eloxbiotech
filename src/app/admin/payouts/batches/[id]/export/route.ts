import { redirect } from "next/navigation";
import { hasRecentStepUp, requireAdmin } from "@/lib/session";
import { batchTransferCsv } from "@/lib/wallet";
import { csvResponse, sameSiteRequest } from "@/lib/csv";

/** Bank transfer file for a payout batch. Full account numbers: PAYOUT_DETAILS only, fresh authenticator code, audited. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!sameSiteRequest(req)) return new Response("Open exports from the admin area.", { status: 403 });
  const admin = await requireAdmin("PAYOUT_DETAILS");
  if (!(await hasRecentStepUp())) redirect(`/admin/verify?next=${encodeURIComponent("/admin/payouts?tab=sending")}`);
  const { id } = await params;
  const { filename, csv } = await batchTransferCsv(id, admin.id);
  return csvResponse(filename, csv);
}
