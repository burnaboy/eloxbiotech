import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PaymentEvent, PaymentProvider } from "./types";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Built-in simulated gateway for development and automated tests. It never moves money.
 * Webhooks are HMAC-signed exactly like a real gateway, so the same verification path is exercised.
 */
function secret() {
  const s = process.env.TEST_PAYMENT_SECRET;
  if (!s) throw new Error("TEST_PAYMENT_SECRET is not set");
  return s;
}

export function signTestPayload(body: string) {
  return createHmac("sha256", secret()).update(body).digest("hex");
}

export function buildTestEvent(e: DistributiveOmit<PaymentEvent, "eventId"> & { eventId?: string }) {
  const body = JSON.stringify({ eventId: `evt_${randomBytes(8).toString("hex")}`, ...e });
  return { body, signature: signTestPayload(body) };
}

export const testProvider: PaymentProvider = {
  name: "test",
  currencies: ["NGN", "GHS", "ZAR", "KES", "USD"],
  async createCheckout(req) {
    return { redirectUrl: `/pay/test/${encodeURIComponent(req.reference)}` };
  },
  async parseWebhook(rawBody, headers) {
    const sig = headers.get("x-test-signature") ?? "";
    const expected = signTestPayload(rawBody);
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Invalid signature");
    return JSON.parse(rawBody) as PaymentEvent;
  },
  async refund() {
    return { refundId: `test_refund_${randomBytes(8).toString("hex")}`, status: "processed" };
  },
};
