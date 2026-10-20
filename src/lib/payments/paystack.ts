import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PaymentEvent, PaymentProvider } from "./types";

/**
 * Paystack (https://paystack.com/docs/api). Amounts are in kobo, which matches our minor units.
 * Use a test secret key (sk_test_...) until go-live. The key is read from the environment only.
 */
const API = "https://api.paystack.co";

function key() {
  const k = process.env.PAYSTACK_SECRET_KEY;
  if (!k) throw new Error("PAYSTACK_SECRET_KEY is not set");
  if (process.env.NODE_ENV !== "production" && !k.startsWith("sk_test_")) {
    throw new Error("Use a Paystack test key (sk_test_...) outside production.");
  }
  return k;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: T };
  if (!res.ok || !body.status) throw new Error(`Paystack ${path} failed: ${body.message ?? res.status}`);
  return body.data as T;
}

interface PaystackTx {
  id: number;
  reference: string;
  status: string;
  amount: number;
  currency: string;
}

export function verifyPaystackSignature(rawBody: string, signature: string, secret: string) {
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function toEvent(tx: PaystackTx, eventId: string): PaymentEvent | null {
  if (tx.status === "success") {
    return { eventId, type: "payment.succeeded", providerRef: tx.reference, amountMinor: tx.amount, currency: tx.currency };
  }
  if (tx.status === "failed" || tx.status === "abandoned") {
    return { eventId, type: "payment.failed", providerRef: tx.reference, amountMinor: tx.amount, currency: tx.currency };
  }
  return null;
}

type Body = { event?: string; data?: Record<string, unknown> };

function str(v: unknown) {
  return typeof v === "string" && v ? v : undefined;
}

/**
 * Maps a signed Paystack webhook to our events. For charges we never trust the body's amount:
 * we re-fetch the transaction from Paystack's verify endpoint.
 * Dispute and refund field names follow Paystack's docs; they are read defensively and should be
 * confirmed against real test-mode deliveries before go-live.
 */
export async function parsePaystackEvent(body: Body, verify: (ref: string) => Promise<PaymentEvent | null>): Promise<PaymentEvent | null> {
  const data = body.data ?? {};
  const tx = (data.transaction ?? {}) as Record<string, unknown>;
  const id = String(data.id ?? "");
  switch (body.event) {
    case "charge.success": {
      const ref = str(data.reference);
      return ref ? verify(ref) : null;
    }
    case "refund.processed": {
      const ref = str(data.transaction_reference) ?? str(tx.reference);
      if (!ref) return null;
      return { eventId: `paystack_refund_${id || ref}`, type: "payment.refunded", providerRef: ref, amountMinor: Number(data.amount ?? 0) };
    }
    case "charge.dispute.create": {
      const ref = str(tx.reference) ?? str(data.transaction_reference);
      return ref ? { eventId: `paystack_dispute_open_${id || ref}`, type: "dispute.opened", providerRef: ref } : null;
    }
    case "charge.dispute.resolve": {
      const ref = str(tx.reference) ?? str(data.transaction_reference);
      if (!ref) return null;
      const resolution = String(data.resolution ?? data.status ?? "").toLowerCase();
      // "merchant-accepted" means the merchant accepted the chargeback, so the money goes back to the customer.
      const merchantLost = resolution.includes("accept") || resolution.includes("lost");
      return { eventId: `paystack_dispute_resolve_${id || ref}`, type: "dispute.resolved", providerRef: ref, merchantLost };
    }
    default:
      return null;
  }
}

export const paystackProvider: PaymentProvider & { verify(ref: string): Promise<PaymentEvent | null> } = {
  name: "paystack",
  async createCheckout(req) {
    const reference = `BC-${req.orderNumber}-${randomBytes(4).toString("hex")}`;
    const data = await call<{ authorization_url: string; reference: string }>("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: req.email,
        amount: req.amountMinor,
        currency: req.currency,
        reference,
        callback_url: `${process.env.APP_URL}/checkout/callback`,
        metadata: { orderId: req.orderId, orderNumber: req.orderNumber },
      }),
    });
    return { providerRef: data.reference, redirectUrl: data.authorization_url };
  },
  async parseWebhook(rawBody, headers) {
    const sig = headers.get("x-paystack-signature") ?? "";
    if (!verifyPaystackSignature(rawBody, sig, key())) throw new Error("Invalid signature");
    return parsePaystackEvent(JSON.parse(rawBody), (ref) => this.verify(ref));
  },
  async verify(reference) {
    const tx = await call<PaystackTx>(`/transaction/verify/${encodeURIComponent(reference)}`);
    return toEvent(tx, `paystack_tx_${tx.id}_${tx.status}`);
  },
  async refund(reference, amountMinor) {
    await call("/refund", { method: "POST", body: JSON.stringify({ transaction: reference, amount: amountMinor }) });
  },
};
