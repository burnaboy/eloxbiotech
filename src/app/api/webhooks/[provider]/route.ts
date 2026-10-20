import { NextResponse, type NextRequest } from "next/server";
import { getProvider } from "@/lib/payments";
import { applyPaymentEvent } from "@/lib/payments/service";
import { logError } from "@/lib/log";

/**
 * Payment gateway webhooks, e.g. POST /api/webhooks/paystack.
 * The raw body is read once and the signature checked before anything else.
 * We answer 200 for events we choose to ignore so the gateway doesn't retry them forever.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: name } = await params;
  let provider;
  try {
    provider = getProvider(name);
  } catch {
    return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  }
  const raw = await req.text();
  if (raw.length > 1_000_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  let event;
  try {
    event = await provider.parseWebhook(raw, req.headers);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "Invalid signature") return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    logError("webhook parse", e);
    return NextResponse.json({ error: "temporary failure" }, { status: 500 }); // gateway will retry
  }
  if (!event) return NextResponse.json({ ok: true, ignored: true });
  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    /* the provider already parsed it; keep the normalised event only */
  }
  try {
    const result = await applyPaymentEvent(provider.name, event, "webhook", payload ?? event);
    return NextResponse.json({ ok: true, result: result.status });
  } catch (e) {
    // Nothing was saved (the transaction rolled back), so the gateway's retry will be processed normally.
    logError("webhook processing", e);
    return NextResponse.json({ error: "temporary failure" }, { status: 500 });
  }
}
