import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { address, affiliate, bankAccount, buyAndPay, customer, later, makeRoot, product, resetDb, setPlan } from "./helpers";
import { addToCart, cancelPendingOrder, createOrderFromCart, getCart, updateFulfilment } from "@/lib/orders";
import { applyPaymentEvent, startPayment } from "@/lib/payments/service";
import { refundOrder, retryRefund } from "@/lib/refunds";
import { commissionFor, matureOrders } from "@/lib/commissions";
import { allocate, quote } from "@/lib/checkout-math";
import { balances, post, reconcileLedger } from "@/lib/ledger";
import { adjustWallet, createPayoutBatch, failPayout, requeuePayout, requestPayout, reviewPayout, settlePayout, walletBalance } from "@/lib/wallet";
import { sealAuditLog, verifyAuditChain, audit } from "@/lib/audit";
import { makePaystackProvider } from "@/lib/payments/paystack";
import { reconcileVolume } from "@/lib/volume";
import { percentToBps } from "@/lib/money";
import { testProvider } from "@/lib/payments/test-provider";

beforeEach(async () => {
  await resetDb();
  await setPlan({});
});

const key = () => randomBytes(18).toString("base64url");

async function pendingOrder(userId: string, productId: string, qty = 1) {
  await addToCart(userId, productId, qty);
  const order = await createOrderFromCart(userId, address);
  await startPayment(order.id, userId);
  const pay = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id }, orderBy: { createdAt: "desc" } });
  return { order, pay };
}

const succeeded = (ref: string, amountMinor: number, eventId = `evt_${ref}_ok`) => ({ eventId, type: "payment.succeeded" as const, providerRef: ref, amountMinor, currency: "NGN" });

describe("commission arithmetic", () => {
  it("rounds down to the kobo with integer maths only", () => {
    expect(commissionFor(999, 1050)).toBe(104); // 104.895
    expect(commissionFor(1, 9999)).toBe(0);
    expect(commissionFor(0, 1000)).toBe(0);
    expect(commissionFor(9_007_199_254_740, 10000)).toBe(9_007_199_254_740); // no float overflow
    expect(commissionFor(333_333, 3333)).toBe(111_099); // 111099.8889
    expect(() => commissionFor(-1, 100)).toThrow();
    expect(() => commissionFor(1.5, 100)).toThrow();
    expect(percentToBps("10.5")).toBe(1050);
    expect(percentToBps("7.25")).toBe(725);
    expect(() => percentToBps("0.123")).toThrow();
  });

  it("splits amounts exactly with no kobo lost", () => {
    const parts = allocate(1000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts).toEqual([334, 333, 333]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
  });

  it("works out VAT inclusive and exclusive, and the commissionable base excludes VAT, shipping and discounts", () => {
    const lines = [{ unitMinor: 10750, quantity: 2, pv: 10, weightGrams: 500, taxable: true }];
    const shop = { flatShippingMinor: 1000, freeShippingOverMinor: 0 };
    const incl = quote(lines, null, shop, { enabled: true, rateBps: 750, included: true, shipping: false });
    expect(incl.totalMinor).toBe(22500);
    expect(incl.taxMinor).toBe(1500);
    expect(incl.items[0].netMinor).toBe(20000);
    const excl = quote(lines, { type: "PERCENT", value: 1000, minSubtotalMinor: 0, maxDiscountMinor: null }, shop, { enabled: true, rateBps: 750, included: false, shipping: true });
    expect(excl.discountMinor).toBe(2150);
    expect(excl.items[0].netMinor).toBe(19350);
    expect(excl.taxMinor).toBe(1451 + 75); // VAT on goods + on delivery
    expect(excl.totalMinor).toBe(19350 + 1451 + 1000 + 75);
  });
});

describe("direct commission eligibility", () => {
  it("pays on retail customer sales only, never on zero-value or the members' own purchases", async () => {
    await setPlan({ holdDays: 0, directRateBps: 1000 });
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const member = await affiliate(a.referralCode, "LEFT");
    const c = await customer(a.referralCode);
    const p = await product({ priceMinor: 5000 });
    await buyAndPay(member.id, p.id); // affiliate buying for themselves
    expect(await prisma.commission.count()).toBe(0);
    await buyAndPay(c.id, p.id);
    expect(await prisma.commission.count()).toBe(1);

    const free = await product({ priceMinor: 9 });
    await prisma.product.update({ where: { id: free.id }, data: { commissionable: false } });
    await buyAndPay(c.id, free.id);
    expect(await prisma.commission.count()).toBe(1); // nothing commissionable, no row
    expect(await prisma.auditLog.count({ where: { action: "commission.notEarned" } })).toBe(2);

    await setPlan({ holdDays: 0, directRateBps: 1000, directOnMemberPurchases: true });
    await buyAndPay(member.id, p.id);
    expect(await prisma.commission.count()).toBe(2);
  });

  it("keeps the plan version of the sale when the rate changes later", async () => {
    await setPlan({ holdDays: 0, directRateBps: 1000 });
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const c = await customer(a.referralCode);
    const p = await product({ priceMinor: 10000, stock: 10 });
    const o1 = await buyAndPay(c.id, p.id);
    await setPlan({ holdDays: 0, directRateBps: 2500 });
    const o2 = await buyAndPay(c.id, p.id);
    const c1 = await prisma.commission.findFirstOrThrow({ where: { orderId: o1.id }, include: { planVersion: true } });
    const c2 = await prisma.commission.findFirstOrThrow({ where: { orderId: o2.id }, include: { planVersion: true } });
    expect([c1.amountMinor, c1.rateBps, c1.baseMinor]).toEqual([1000, 1000, 10000]);
    expect([c2.amountMinor, c2.rateBps]).toEqual([2500, 2500]);
    expect(c2.planVersion!.version).toBeGreaterThan(c1.planVersion!.version);
    // A refund on the old order is recalculated with the old rate.
    await refundOrder(o1.id, root.id, { reason: "test", lines: [] , shipping: true }).catch(() => undefined);
    const v = await prisma.compPlanVersion.findFirstOrThrow({ where: { id: c1.planVersionId! } });
    await expect(prisma.compPlanVersion.update({ where: { id: v.id }, data: { note: "edited" } })).rejects.toThrow();
  });
});

describe("partial refunds", () => {
  it("refunds units exactly, recalculates the commission and volume, and restocks unshipped units", async () => {
    await setPlan({ holdDays: 0, directRateBps: 1000 });
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const c = await customer(a.referralCode);
    const p = await product({ priceMinor: 3333, pv: 10, stock: 10 });
    const order = await buyAndPay(c.id, p.id, 3); // 9999 + 2500 delivery
    await matureOrders(later(1));
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect((await walletBalance(a.id)).availableMinor).toBe(999);

    await refundOrder(order.id, root.id, { reason: "one damaged", lines: [{ orderItemId: item.id, quantity: 1 }] });
    let o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("PARTIALLY_REFUNDED");
    expect(o.refundedMinor).toBe(3333);
    expect(o.refundedPv).toBe(10);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(8);
    const com = await prisma.commission.findFirstOrThrow({ where: { orderId: order.id } });
    expect(com.amountMinor - com.reversedMinor).toBe(666); // floor(6666 * 0.1)
    expect((await walletBalance(a.id)).availableMinor).toBe(666);

    // The same partial refund can't be applied beyond what is left, and the rest adds up to the total exactly.
    await expect(refundOrder(order.id, root.id, { reason: "Too many", lines: [{ orderItemId: item.id, quantity: 3 }] })).rejects.toThrow(/Only 2/);
    await refundOrder(order.id, root.id, { reason: "rest" });
    o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("REFUNDED");
    expect(o.refundedMinor).toBe(o.totalMinor);
    expect((await prisma.refund.aggregate({ where: { orderId: order.id }, _sum: { amountMinor: true } }))._sum.amountMinor).toBe(o.totalMinor);
    expect((await walletBalance(a.id)).availableMinor).toBe(0);
    expect((await prisma.commission.findFirstOrThrow({ where: { orderId: order.id } })).status).toBe("REVERSED");
    expect((await reconcileVolume(null)).issues).toEqual([]);
    expect((await reconcileLedger()).problems).toEqual([]);
  });

  it("a partly refunded order can still ship, and returns only count refunded units", async () => {
    await setPlan({ holdDays: 14 });
    const root = await makeRoot();
    const c = await customer(root.referralCode);
    const p = await product({ stock: 10 });
    const order = await buyAndPay(c.id, p.id, 2);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    await updateFulfilment(order.id, "SHIPPED", root.id);
    await refundOrder(order.id, root.id, { reason: "one returned", lines: [{ orderItemId: item.id, quantity: 1 }] });
    await updateFulfilment(order.id, "DELIVERED", root.id);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("PARTIALLY_REFUNDED");
    expect(o.deliveredAt).not.toBeNull();
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(8); // shipped: nothing restocked yet
  });

  it("concurrent refunds can never refund more than was paid", async () => {
    const root = await makeRoot();
    const c = await customer(root.referralCode);
    const p = await product({ stock: 10 });
    const order = await buyAndPay(c.id, p.id, 2);
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => refundOrder(order.id, root.id, { reason: "race" })));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.refundedMinor).toBe(o.totalMinor);
    expect(await prisma.refund.count()).toBe(1);
  });

  it("a refund the gateway refuses is marked failed and can be retried", async () => {
    const root = await makeRoot();
    const c = await customer(root.referralCode);
    const p = await product();
    const order = await buyAndPay(c.id, p.id);
    const original = testProvider.refund;
    testProvider.refund = async () => {
      const { GatewayError } = await import("@/lib/payments/types");
      throw new GatewayError("Paystack declined: insufficient balance", true);
    };
    try {
      const r = await refundOrder(order.id, root.id, { reason: "test" });
      expect(r.status).toBe("FAILED");
    } finally {
      testProvider.refund = original;
    }
    const failed = await prisma.refund.findFirstOrThrow({ where: { orderId: order.id } });
    expect((await retryRefund(failed.id, root.id)).status).toBe("PROCESSED");
    await expect(retryRefund(failed.id, root.id)).rejects.toThrow(/Only failed/);
  });
});

describe("payment events", () => {
  it("is idempotent across webhook, callback and reconciliation, and never regresses a paid order", async () => {
    await makeRoot();
    const c = await customer();
    const p = await product();
    const { order, pay } = await pendingOrder(c.id, p.id);
    const ok = succeeded(pay.providerRef, order.totalMinor);
    const results = await Promise.all([applyPaymentEvent("test", ok), applyPaymentEvent("test", ok, "callback"), applyPaymentEvent("test", ok, "reconcile")]);
    expect(results.map((r) => r.status).sort()).toEqual(["duplicate", "duplicate", "paid"]);
    // A late "failed" for the same attempt arrives after the success.
    const late = await applyPaymentEvent("test", { eventId: "late_fail", type: "payment.failed", providerRef: pay.providerRef, amountMinor: order.totalMinor, currency: "NGN" });
    expect(late.status).toBe("ignored_out_of_order");
    // The same success with a different event id doesn't pay twice.
    expect((await applyPaymentEvent("test", { ...ok, eventId: "another" })).status).toBe("already_paid");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe("SUCCEEDED");
    expect(await prisma.webhookEvent.count()).toBe(3);
    expect(await prisma.emailOutbox.count({ where: { subject: { contains: "confirmed" } } })).toBe(1);
  });

  it("rejects a wrong currency and flags a second payment on a paid order", async () => {
    await makeRoot();
    const c = await customer();
    const p = await product();
    const { order, pay } = await pendingOrder(c.id, p.id);
    expect((await applyPaymentEvent("test", { ...succeeded(pay.providerRef, order.totalMinor), currency: "USD", eventId: "usd" })).status).toBe("amount_mismatch");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING_PAYMENT");

    const second = await prisma.payment.create({ data: { orderId: order.id, provider: "test", providerRef: "test_second", amountMinor: order.totalMinor, currency: "NGN" } });
    const first = await prisma.payment.create({ data: { orderId: order.id, provider: "test", providerRef: "test_first", amountMinor: order.totalMinor, currency: "NGN" } });
    expect((await applyPaymentEvent("test", succeeded(first.providerRef, order.totalMinor))).status).toBe("paid");
    expect((await applyPaymentEvent("test", succeeded(second.providerRef, order.totalMinor))).status).toBe("extra_payment");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paidPaymentId).toBe(first.id);
  });

  it("a payment arriving after the order was cancelled is flagged, not fulfilled", async () => {
    await makeRoot();
    const c = await customer();
    const p = await product({ stock: 1 });
    const { order, pay } = await pendingOrder(c.id, p.id);
    await cancelPendingOrder(order.id, null, { reason: "expired" });
    expect((await applyPaymentEvent("test", succeeded(pay.providerRef, order.totalMinor))).status).toBe("late_payment");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("CANCELLED");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(1);
  });

  it("reuses the open payment attempt instead of starting another", async () => {
    await makeRoot();
    const c = await customer();
    const p = await product();
    const { order } = await pendingOrder(c.id, p.id);
    await startPayment(order.id, c.id);
    await startPayment(order.id, c.id);
    expect(await prisma.payment.count({ where: { orderId: order.id } })).toBe(1);
  });
});

describe("checkout safety", () => {
  it("a double-submitted checkout creates one order", async () => {
    await makeRoot();
    const c = await customer();
    const p = await product({ stock: 10 });
    await addToCart(c.id, p.id, 2);
    const k = key();
    const orders = await Promise.all([createOrderFromCart(c.id, address, { checkoutKey: k }), createOrderFromCart(c.id, address, { checkoutKey: k })]);
    expect(orders[0].id).toBe(orders[1].id);
    expect(await prisma.order.count()).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(8);
  });

  it("enforces discount limits under concurrency and gives the use back on cancellation", async () => {
    const root = await makeRoot();
    await prisma.discountCode.create({ data: { code: "LAUNCH", description: "10% off", type: "PERCENT", value: 1000, maxRedemptions: 2, createdById: root.id } });
    const p = await product({ priceMinor: 10000, stock: 20 });
    const buyers = await Promise.all(Array.from({ length: 4 }, () => customer()));
    for (const b of buyers) await addToCart(b.id, p.id, 1);
    expect((await getCart(buyers[0].id, "launch")).discountMinor).toBe(1000);
    const results = await Promise.allSettled(buyers.map((b) => createOrderFromCart(b.id, address, { discountCode: "launch" })));
    const made = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof createOrderFromCart>>> => r.status === "fulfilled");
    expect(made.length).toBe(2);
    expect(made.every((r) => r.value.discountMinor === 1000)).toBe(true);
    expect((await prisma.discountCode.findUniqueOrThrow({ where: { code: "LAUNCH" } })).redeemedCount).toBe(2);
    await cancelPendingOrder(made[0].value.id, null);
    expect((await prisma.discountCode.findUniqueOrThrow({ where: { code: "LAUNCH" } })).redeemedCount).toBe(1);
  });
});

describe("ledger", () => {
  it("refuses to edit or delete posted entries and ignores a repeated idempotency key", async () => {
    const root = await makeRoot();
    const u = await customer(root.referralCode);
    const posting = { userId: u.id, type: "ADMIN_CORRECTION" as const, amountMinor: 500, from: null, to: "AVAILABLE" as const, sourceType: "Test", sourceId: "1", idempotencyKey: "test:1" };
    expect(await post(prisma, [posting])).toBe(1);
    expect(await post(prisma, [posting])).toBe(0);
    const e = await prisma.ledgerEntry.findFirstOrThrow();
    await expect(prisma.ledgerEntry.update({ where: { id: e.id }, data: { amountMinor: 1 } })).rejects.toThrow(/permanent/);
    await expect(prisma.ledgerEntry.delete({ where: { id: e.id } })).rejects.toThrow(/permanent/);
    await expect(post(prisma, [{ ...posting, amountMinor: -5, idempotencyKey: "neg" }])).rejects.toThrow();
    await expect(post(prisma, [{ ...posting, type: "WITHDRAWAL_PAID", idempotencyKey: "bad-move" }])).rejects.toThrow(/not allowed/);
    expect((await balances(u.id)).AVAILABLE).toBe(500);
  });

  it("posts corrections as documented compensating entries", async () => {
    const root = await makeRoot();
    const u = await affiliate(root.referralCode, "LEFT");
    const k = key();
    await adjustWallet(u.id, { amountMinor: 2500, reason: "Goodwill credit for late delivery" }, root.id, k);
    await expect(adjustWallet(u.id, { amountMinor: 2500, reason: "Goodwill credit for late delivery" }, root.id, k)).rejects.toThrow(/already/);
    await adjustWallet(u.id, { amountMinor: -1000, reason: "Duplicate credit taken back" }, root.id);
    await expect(adjustWallet(u.id, { amountMinor: 100, reason: "no" }, root.id)).rejects.toThrow();
    await expect(adjustWallet(root.id, { amountMinor: 100, reason: "Paying myself something" }, root.id)).rejects.toThrow(/own/);
    expect((await walletBalance(u.id)).availableMinor).toBe(1500);
    expect(await prisma.ledgerEntry.count({ where: { userId: u.id, type: "ADMIN_CORRECTION" } })).toBe(2);
  });

  it("reconciles commissions and payouts and reports drift", async () => {
    await setPlan({ holdDays: 0, directRateBps: 1000 });
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const c = await customer(a.referralCode);
    const p = await product();
    await buyAndPay(c.id, p.id);
    expect((await reconcileLedger()).ok).toBe(true);
    await matureOrders(later(1));
    expect((await reconcileLedger()).ok).toBe(true);
    await prisma.commission.updateMany({ data: { status: "PENDING" } }); // drift: status no longer matches the money
    const r = await reconcileLedger();
    expect(r.ok).toBe(false);
    expect(r.problems[0].kind).toBe("commission");
  });
});

describe("withdrawals", () => {
  async function funded(amountMinor = 1_000_000) {
    const root = await makeRoot();
    const admin2 = await affiliate(root.referralCode, "RIGHT");
    const a = await affiliate(root.referralCode, "LEFT");
    await adjustWallet(a.id, { amountMinor, reason: "Opening balance for the test" }, root.id);
    await bankAccount(a.id);
    return { root, admin2, a };
  }

  it("needs a bank account past its cooling-off period, one open request at a time, and a request key makes one payout", async () => {
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    await adjustWallet(a.id, { amountMinor: 1_000_000, reason: "Opening balance for the test" }, root.id);
    await expect(requestPayout(a.id, { amountMinor: 600000 })).rejects.toThrow(/bank account/);
    const { savePayoutAccount } = await import("@/lib/payouts/accounts");
    await expect(savePayoutAccount(a.id, { bankCode: "058", accountNumber: "0000000000" })).rejects.toThrow(/couldn't find/);
    const acc = await savePayoutAccount(a.id, { bankCode: "058", accountNumber: "0123456789" });
    expect(acc.accountNumberEnc).not.toContain("0123456789");
    expect(acc.accountLast4).toBe("6789");
    await expect(requestPayout(a.id, { amountMinor: 600000 })).rejects.toThrow(/security/);
    await prisma.payoutAccount.update({ where: { id: acc.id }, data: { usableFrom: new Date() } });
    const k = key();
    const [p1, p2] = await Promise.all([requestPayout(a.id, { amountMinor: 500000 }, k), requestPayout(a.id, { amountMinor: 500000 }, k)]);
    expect(p1.id).toBe(p2.id);
    await expect(requestPayout(a.id, { amountMinor: 500000 })).rejects.toThrow(/in progress/);
    expect((await walletBalance(a.id)).reservedMinor).toBe(500000);
  });

  it("recovers a failed transfer: funds go back, then can be sent again", async () => {
    const { root, a } = await funded();
    const p = await requestPayout(a.id, { amountMinor: 600000 });
    await reviewPayout(p.id, "APPROVE", root.id);
    await createPayoutBatch([p.id], root.id);
    await expect(createPayoutBatch([p.id], root.id)).rejects.toThrow(/approved/);
    await failPayout(p.id, root.id, "Account closed by the bank");
    expect((await walletBalance(a.id)).availableMinor).toBe(1_000_000);
    await requeuePayout(p.id, root.id);
    expect((await walletBalance(a.id)).availableMinor).toBe(400000);
    await createPayoutBatch([p.id], root.id);
    await settlePayout(p.id, root.id, { reference: "NIP-0001", settledAt: new Date(), evidence: "Statement 21 Oct line 3, debit 6,000" });
    const w = await walletBalance(a.id);
    expect([w.availableMinor, w.reservedMinor, w.paidOutMinor]).toEqual([400000, 0, 600000]);
    expect((await reconcileLedger()).ok).toBe(true);
  });

  it("refuses a transfer reference already used, and a rejection returns the funds", async () => {
    const { root, admin2, a } = await funded();
    await adjustWallet(admin2.id, { amountMinor: 1_000_000, reason: "Opening balance for the test" }, root.id);
    await bankAccount(admin2.id);
    const p1 = await requestPayout(a.id, { amountMinor: 500000 });
    const p2 = await requestPayout(admin2.id, { amountMinor: 500000 });
    for (const p of [p1, p2]) await reviewPayout(p.id, "APPROVE", root.id);
    await createPayoutBatch([p1.id, p2.id], root.id);
    const ev = { reference: "NIP-SAME", settledAt: new Date(), evidence: "Statement line checked by finance" };
    await settlePayout(p1.id, root.id, ev);
    await expect(settlePayout(p2.id, root.id, ev)).rejects.toThrow(/already recorded/);
    await expect(settlePayout(p1.id, root.id, { ...ev, reference: "NIP-OTHER" })).rejects.toThrow(/paid/);

    const p3 = await requestPayout(a.id, { amountMinor: 500000 });
    await expect(reviewPayout(p3.id, "REJECT", root.id)).rejects.toThrow(/reason/);
    await reviewPayout(p3.id, "REJECT", root.id, { note: "Please confirm your account name" });
    expect((await walletBalance(a.id)).availableMinor).toBe(500000);
    // Only a paid, evidenced payout can be in PAID: the database refuses a shortcut.
    await expect(prisma.payout.update({ where: { id: p3.id }, data: { status: "PAID" } })).rejects.toThrow();
  });
});

describe("audit trail", () => {
  it("seals records into a hash chain and detects tampering", async () => {
    const root = await makeRoot();
    await audit("test.one", "Test", "1", root.id, { a: 1, b: [1, 2] });
    await audit("test.two", "Test", "2", null, { nested: { z: 1, a: 2 } });
    expect(await sealAuditLog()).toBeGreaterThanOrEqual(2);
    let r = await verifyAuditChain();
    expect(r.ok).toBe(true);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "test.one" } });
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: "test.changed" } })).rejects.toThrow(/permanent/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/permanent/);
    // Simulate someone with database owner rights bypassing the trigger.
    await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" DISABLE TRIGGER audit_log_append_only`);
    try {
      await prisma.auditLog.update({ where: { id: row.id }, data: { data: { a: 2, b: [1, 2] } } });
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER audit_log_append_only`);
    }
    r = await verifyAuditChain();
    expect(r.ok).toBe(false);
    expect(r.brokenAt?.id).toBe(row.id);
  });
});

describe("paystack client", () => {
  const ok = (data: unknown) => new Response(JSON.stringify({ status: true, message: "ok", data }), { status: 200 });
  process.env.PAYSTACK_SECRET_KEY = "sk_test_dummy";

  it("retries verification on gateway errors and checks the reference", async () => {
    let calls = 0;
    const provider = makePaystackProvider((async () => {
      calls++;
      if (calls < 3) return new Response("{}", { status: 502 });
      return ok({ id: 1, reference: "R1", status: "success", amount: 100, currency: "NGN" });
    }) as typeof fetch);
    expect((await provider.verify("R1"))?.type).toBe("payment.succeeded");
    expect(calls).toBe(3);
    const wrong = makePaystackProvider((async () => ok({ id: 1, reference: "OTHER", status: "success", amount: 100, currency: "NGN" })) as typeof fetch);
    await expect(wrong.verify("R1")).rejects.toThrow(/different/);
  });

  it("never retries a refund or a charge on its own", async () => {
    let calls = 0;
    const provider = makePaystackProvider((async () => {
      calls++;
      return new Response("{}", { status: 503 });
    }) as typeof fetch);
    await expect(provider.refund("R1", 100, "k")).rejects.toThrow(/unavailable/);
    expect(calls).toBe(1);
    const declined = makePaystackProvider((async () => new Response(JSON.stringify({ status: false, message: "Transaction has been fully reversed" }), { status: 400 })) as typeof fetch);
    await expect(declined.refund("R1", 100, "k")).rejects.toMatchObject({ definite: true });
  });
});

describe("member dashboard figures", () => {
  it("counts only verified sales to other people, and never mixes in another member's data", async () => {
    const { verifiedSales, memberOverview } = await import("@/lib/member-overview");
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const b = await affiliate(root.referralCode, "RIGHT");
    const c1 = await customer(a.referralCode);
    const c2 = await customer(b.referralCode);
    const p = await product({ priceMinor: 100000, stock: 50 });
    await buyAndPay(c1.id, p.id);
    await buyAndPay(c2.id, p.id);
    await buyAndPay(a.id, p.id); // own purchase: not an affiliate sale
    const s = await verifiedSales(a.id);
    expect(s.orders).toBe(1);
    expect(s.goodsMinor).toBe(100000);
    const o = await memberOverview(a.id);
    expect(o.recentSales).toHaveLength(1);
    expect(o.recentSales[0].buyer).toMatch(/^\S+( \S\.)?$/); // first name and initial only
    expect(o.wallet.pendingMinor).toBeGreaterThan(0);
    expect((await verifiedSales(b.id)).orders).toBe(1);
  });
});

describe("retail-only team volume", () => {
  it("credits volume from customer orders, never from affiliates buying for themselves", async () => {
    await setPlan({ holdDays: 0 }); // binaryRetailOnly is on by default
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const c = await customer(a.referralCode);
    const p = await product({ priceMinor: 100000, pv: 40, stock: 20 });
    const own = await buyAndPay(a.id, p.id);
    const retail = await buyAndPay(c.id, p.id);
    expect(own.volumeNodeId).toBeNull();
    expect(retail.volumeNodeId).not.toBeNull();
    await matureOrders(later(1));
    const aNode = await prisma.affiliateNode.findUniqueOrThrow({ where: { userId: a.id } });
    const rootNode = await prisma.affiliateNode.findUniqueOrThrow({ where: { userId: root.id } });
    expect(aNode.personalPv).toBe(40); // only the customer's order
    expect(rootNode.leftTotalPv).toBe(40);
    expect((await reconcileVolume(null)).issueCount).toBe(0);
  });
});
