import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { toEvent, verifyPaystackSignature } from "@/lib/payments/paystack";
import { formatMoney } from "@/lib/money";

describe("paystack", () => {
  it("accepts only bodies signed with the secret key (HMAC SHA-512)", () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "x" } });
    const sig = createHmac("sha512", "sk_test_abc").update(body).digest("hex");
    expect(verifyPaystackSignature(body, sig, "sk_test_abc")).toBe(true);
    expect(verifyPaystackSignature(body, sig, "sk_test_other")).toBe(false);
    expect(verifyPaystackSignature(body + " ", sig, "sk_test_abc")).toBe(false);
    expect(verifyPaystackSignature(body, "nothex", "sk_test_abc")).toBe(false);
  });

  it("maps verified transactions to payment events", () => {
    expect(toEvent({ id: 1, reference: "r", status: "success", amount: 500000, currency: "NGN" }, "e")?.type).toBe("payment.succeeded");
    expect(toEvent({ id: 1, reference: "r", status: "abandoned", amount: 500000, currency: "NGN" }, "e")?.type).toBe("payment.failed");
    expect(toEvent({ id: 1, reference: "r", status: "ongoing", amount: 500000, currency: "NGN" }, "e")).toBeNull();
  });

  it("formats naira", () => {
    expect(formatMoney(1234500, "NGN")).toBe("₦12,345.00");
  });
});

import { parsePaystackEvent } from "@/lib/payments/paystack";

describe("paystack event mapping", () => {
  const verify = async (ref: string) => ({ eventId: "v", type: "payment.succeeded" as const, providerRef: ref, amountMinor: 1, currency: "NGN" });

  it("re-verifies charge.success instead of trusting the body", async () => {
    let asked = "";
    const e = await parsePaystackEvent({ event: "charge.success", data: { reference: "R1", amount: 999999999 } }, async (r) => {
      asked = r;
      return verify(r);
    });
    expect(asked).toBe("R1");
    expect(e?.type === "payment.succeeded" && e.amountMinor).toBe(1);
  });

  it("maps disputes and refunds, and ignores unknown events", async () => {
    expect((await parsePaystackEvent({ event: "charge.dispute.create", data: { id: 5, transaction: { reference: "R2" } } }, verify))?.type).toBe("dispute.opened");
    const lost = await parsePaystackEvent({ event: "charge.dispute.resolve", data: { id: 5, resolution: "merchant-accepted", transaction: { reference: "R2" } } }, verify);
    expect(lost?.type === "dispute.resolved" && lost.merchantLost).toBe(true);
    const won = await parsePaystackEvent({ event: "charge.dispute.resolve", data: { id: 5, resolution: "declined", transaction: { reference: "R2" } } }, verify);
    expect(won?.type === "dispute.resolved" && won.merchantLost).toBe(false);
    expect((await parsePaystackEvent({ event: "refund.processed", data: { id: 9, transaction_reference: "R3", amount: 100 } }, verify))?.type).toBe("payment.refunded");
    expect(await parsePaystackEvent({ event: "transfer.success", data: {} }, verify)).toBeNull();
  });
});
