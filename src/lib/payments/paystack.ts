import "server-only";
import { paystackSecretKey } from "./keys";
import { createHmac, timingSafeEqual } from "node:crypto";
import { GatewayError, type PaymentEvent, type PaymentProvider } from "./types";

/**
 * Paystack (https://paystack.com/docs/api). Amounts are in kobo, which matches our minor units.
 * The secret key is read from the environment on the server only and never sent to the browser.
 * Outside production only test keys (sk_test_...) are accepted.
 */
const API = "https://api.paystack.co";
const TIMEOUT_MS = 15_000;

const key = () => paystackSecretKey();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Calls the API with a timeout. GET requests are retried on network errors, 429 and 5xx (they change nothing).
 * POSTs are not retried automatically: a timeout leaves it unknown whether Paystack acted, so the caller
 * records the attempt and reconciles instead of risking a second charge or refund.
 * Throws GatewayError(definite = true) when Paystack answered with a refusal.
 */
async function call<T>(path: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const attempts = method === "GET" ? 3 : 1;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(300 * 2 ** i);
    let res: Response;
    try {
      res = await fetchImpl(`${API}${path}`, {
        ...init,
        method,
        headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      lastError = new GatewayError(`Couldn't reach Paystack (${e instanceof Error ? e.name : "network error"}).`, false);
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: T };
    if (res.status === 429 || res.status >= 500) {
      lastError = new GatewayError(`Paystack is unavailable right now (HTTP ${res.status}).`, false);
      continue;
    }
    if (!res.ok || !body.status) throw new GatewayError(`Paystack declined: ${body.message ?? `HTTP ${res.status}`}`, true);
    return body.data as T;
  }
  throw lastError;
}

interface PaystackTx {
  id: number;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  gateway_response?: string;
}

/** HMAC-SHA512 of the exact raw request body with the secret key, compared in constant time. */
export function verifyPaystackSignature(rawBody: string, signature: string, secret: string) {
  if (!/^[0-9a-f]+$/i.test(signature)) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A verified transaction as an event. Pending/ongoing states return null (nothing to do yet). */
export function toEvent(tx: PaystackTx): PaymentEvent | null {
  const eventId = `paystack_tx_${tx.id}_${tx.status}`;
  if (tx.status === "success") {
    return { eventId, type: "payment.succeeded", providerRef: tx.reference, amountMinor: tx.amount, currency: tx.currency };
  }
  if (tx.status === "failed" || tx.status === "abandoned" || tx.status === "reversed") {
    return { eventId, type: "payment.failed", providerRef: tx.reference, amountMinor: tx.amount, currency: tx.currency, reason: tx.gateway_response ?? tx.status };
  }
  return null;
}

type Body = { event?: string; data?: Record<string, unknown> };

function str(v: unknown) {
  return typeof v === "string" && v ? v : typeof v === "number" ? String(v) : undefined;
}
function int(v: unknown) {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
}

/**
 * Maps a signed Paystack webhook to our events. For charges the body's amount is never trusted:
 * the transaction is re-fetched from the verify endpoint.
 * Refund and dispute field names follow Paystack's documentation and are read defensively; confirm them
 * against real test-mode deliveries before go-live (the raw payload of every event is stored).
 */
export async function parsePaystackEvent(body: Body, verify: (ref: string) => Promise<PaymentEvent | null>): Promise<PaymentEvent | null> {
  const data = body.data ?? {};
  const tx = (data.transaction ?? {}) as Record<string, unknown>;
  const id = str(data.id);
  const txRef = str(data.transaction_reference) ?? str(tx.reference) ?? str(data.reference);
  switch (body.event) {
    case "charge.success": {
      const ref = str(data.reference);
      return ref ? verify(ref) : null;
    }
    case "refund.pending":
    case "refund.processing":
    case "refund.processed":
    case "refund.failed":
    case "refund.needs-attention": {
      if (!txRef) return null;
      const refundId = id ?? str(data.refund_reference);
      const amountMinor = int(data.amount) ?? 0;
      const status = body.event.slice("refund.".length);
      const eventId = `paystack_refund_${refundId ?? `${txRef}_${amountMinor}`}_${status}`;
      if (status === "processed") return { eventId, type: "refund.processed", providerRef: txRef, amountMinor, refundId };
      if (status === "failed" || status === "needs-attention") return { eventId, type: "refund.failed", providerRef: txRef, amountMinor, refundId, reason: str(data.status) ?? status };
      return { eventId, type: "refund.pending", providerRef: txRef, amountMinor, refundId };
    }
    case "charge.dispute.create": {
      return txRef ? { eventId: `paystack_dispute_open_${id ?? txRef}`, type: "dispute.opened", providerRef: txRef, amountMinor: int(data.refund_amount) } : null;
    }
    case "charge.dispute.resolve": {
      if (!txRef) return null;
      const resolution = String(data.resolution ?? data.status ?? "").toLowerCase();
      // "merchant-accepted" means the merchant accepted the chargeback, so the money goes back to the customer.
      const merchantLost = resolution.includes("accept") || resolution.includes("lost");
      return { eventId: `paystack_dispute_resolve_${id ?? txRef}`, type: "dispute.resolved", providerRef: txRef, merchantLost, amountMinor: int(data.refund_amount) };
    }
    default:
      return null;
  }
}

export function makePaystackProvider(fetchImpl: typeof fetch = fetch): PaymentProvider & { verify(ref: string): Promise<PaymentEvent | null> } {
  return {
    name: "paystack",
    currencies: ["NGN"],
    async createCheckout(req) {
      const data = await call<{ authorization_url: string; reference: string }>(
        "/transaction/initialize",
        {
          method: "POST",
          body: JSON.stringify({
            email: req.email,
            amount: req.amountMinor,
            currency: req.currency,
            reference: req.reference,
            callback_url: `${process.env.APP_URL}/checkout/callback`,
            metadata: { orderId: req.orderId, orderNumber: req.orderNumber },
          }),
        },
        fetchImpl,
      );
      if (data.reference !== req.reference) throw new GatewayError("Paystack returned a different reference.", true);
      return { redirectUrl: data.authorization_url };
    },
    async parseWebhook(rawBody, headers) {
      const sig = headers.get("x-paystack-signature") ?? "";
      if (!verifyPaystackSignature(rawBody, sig, key())) throw new Error("Invalid signature");
      return parsePaystackEvent(JSON.parse(rawBody), (ref) => this.verify(ref));
    },
    async verify(reference) {
      const tx = await call<PaystackTx>(`/transaction/verify/${encodeURIComponent(reference)}`, {}, fetchImpl);
      if (tx.reference !== reference) throw new GatewayError("Paystack returned a different transaction.", true);
      return toEvent(tx);
    },
    async refund(reference, amountMinor) {
      const data = await call<{ id?: number | string; status?: string }>("/refund", { method: "POST", body: JSON.stringify({ transaction: reference, amount: amountMinor }) }, fetchImpl);
      return { refundId: data.id !== undefined ? String(data.id) : undefined, status: data.status === "processed" ? "processed" : "pending" };
    },
  };
}

export const paystackProvider = makePaystackProvider();

/** Successful Paystack transactions created in [from, to), all pages. Read-only. */
export async function listSuccessfulTransactions(from: Date, to: Date, fetchImpl: typeof fetch = fetch) {
  const perPage = 100;
  const out: PaystackTx[] = [];
  for (let page = 1; page <= 200; page++) {
    const q = new URLSearchParams({ status: "success", perPage: String(perPage), page: String(page), from: from.toISOString(), to: to.toISOString() });
    const rows = await call<PaystackTx[]>(`/transaction?${q}`, {}, fetchImpl);
    out.push(...rows);
    if (rows.length < perPage) break;
  }
  return out;
}
