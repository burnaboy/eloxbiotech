import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { address, affiliate, customer, makeRoot, node, product, resetDb, setPlan } from "./helpers";
import { addToCart, applyPaymentEvent, cancelPendingOrder, createOrderFromCart, expireStaleOrders, refundOrder, startPayment } from "@/lib/orders";
import { matureOrders, runBinary } from "@/lib/commissions";
import { testProvider, buildTestEvent } from "@/lib/payments/test-provider";
import { processPayout, requestPayout, walletBalance } from "@/lib/wallet";
import { authenticate } from "@/lib/auth";
import { becomeAffiliate } from "@/lib/users";

async function buyAndPay(userId: string, productId: string, qty = 1) {
  await addToCart(userId, productId, qty);
  const order = await createOrderFromCart(userId, address);
  await startPayment(order.id, userId);
  const pay = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
  const { body, signature } = buildTestEvent({ type: "payment.succeeded", providerRef: pay.providerRef, amountMinor: order.totalMinor, currency: "NGN" });
  const event = await testProvider.parseWebhook(body, new Headers({ "x-test-signature": signature }));
  const res = await applyPaymentEvent("test", event!);
  expect(res.status).toBe("paid");
  return order;
}

const later = (days: number) => new Date(Date.now() + days * 864e5);

beforeEach(async () => {
  await resetDb();
  await setPlan({});
});

describe("accounts", () => {
  it("rejects bad passwords and locks out after repeated failures", async () => {
    const u = await customer();
    await expect(authenticate(u.email, "wrongpass1", "1.1.1.1")).rejects.toThrow(/incorrect/);
    for (let i = 0; i < 4; i++) await authenticate(u.email, "nope", "1.1.1.1").catch(() => {});
    await expect(authenticate(u.email, "password123", "1.1.1.1")).rejects.toThrow(/Too many/);
  });

  it("rejects duplicate emails and invalid referral codes", async () => {
    const u = await customer();
    await expect(customer("NOPE1234")).rejects.toThrow(/referral code/);
    const { registerUser } = await import("@/lib/users");
    await expect(registerUser({ name: "Dup", email: u.email, password: "password123" })).rejects.toThrow(/already exists/);
  });
});

describe("binary tree placement", () => {
  it("places on the chosen leg and spills over down the outside edge", async () => {
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const b = await affiliate(root.referralCode, "LEFT");
    const c = await affiliate(root.referralCode, "LEFT");
    const d = await affiliate(root.referralCode, "RIGHT");
    const [ra, nb, nc, nd, rn] = await Promise.all([node(a.id), node(b.id), node(c.id), node(d.id), node(root.id)]);
    expect(ra.parentId).toBe(rn.id);
    expect(nb.parentId).toBe(ra.id);
    expect(nb.position).toBe("LEFT");
    expect(nc.parentId).toBe(nb.id);
    expect(nd.parentId).toBe(rn.id);
    expect(nd.position).toBe("RIGHT");
    const r = await node(root.id);
    expect(r.leftCount).toBe(3);
    expect(r.rightCount).toBe(1);
    expect((await node(a.id)).leftCount).toBe(2);
  });

  it("fills the weaker leg by default", async () => {
    const root = await makeRoot();
    await affiliate(root.referralCode, "LEFT");
    const x = await affiliate(root.referralCode);
    expect((await node(x.id)).position).toBe("RIGHT");
  });

  it("never puts two members in the same slot under concurrent sign-ups", async () => {
    const root = await makeRoot();
    await Promise.all(Array.from({ length: 12 }, () => affiliate(root.referralCode, "LEFT")));
    const nodes = await prisma.affiliateNode.findMany();
    const slots = new Set(nodes.filter((n) => n.parentId).map((n) => `${n.parentId}:${n.position}`));
    expect(slots.size).toBe(12);
    expect((await node(root.id)).leftCount).toBe(12);
  });

  it("lets a customer upgrade to affiliate under their sponsor", async () => {
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "RIGHT");
    const c = await customer(a.referralCode);
    await becomeAffiliate(c.id, "LEFT");
    const n = await node(c.id);
    expect(n.parentId).toBe((await node(a.id)).id);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.id } })).role).toBe("AFFILIATE");
  });
});

describe("checkout, stock and payments", () => {
  it("reserves stock, and never oversells under concurrent checkouts", async () => {
    await makeRoot();
    const p = await product({ stock: 3 });
    const buyers = await Promise.all(Array.from({ length: 6 }, () => customer()));
    for (const b of buyers) await addToCart(b.id, p.id, 1);
    const results = await Promise.allSettled(buyers.map((b) => createOrderFromCart(b.id, address)));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(3);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(0);
  });

  it("rejects forged webhooks and ignores replays", async () => {
    await makeRoot();
    const u = await customer();
    const p = await product();
    await addToCart(u.id, p.id);
    const order = await createOrderFromCart(u.id, address);
    await startPayment(order.id, u.id);
    const pay = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    const { body, signature } = buildTestEvent({ type: "payment.succeeded", providerRef: pay.providerRef, amountMinor: order.totalMinor, currency: "NGN" });
    await expect(testProvider.parseWebhook(body, new Headers({ "x-test-signature": "00".repeat(32) }))).rejects.toThrow();
    const e = (await testProvider.parseWebhook(body, new Headers({ "x-test-signature": signature })))!;
    expect((await applyPaymentEvent("test", e)).status).toBe("paid");
    expect((await applyPaymentEvent("test", e)).status).toBe("duplicate");
  });

  it("refuses to mark an order paid when the amount doesn't match", async () => {
    await makeRoot();
    const u = await customer();
    const p = await product();
    await addToCart(u.id, p.id);
    const order = await createOrderFromCart(u.id, address);
    await startPayment(order.id, u.id);
    const pay = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    const { body, signature } = buildTestEvent({ type: "payment.succeeded", providerRef: pay.providerRef, amountMinor: 1, currency: "NGN" });
    const e = (await testProvider.parseWebhook(body, new Headers({ "x-test-signature": signature })))!;
    expect((await applyPaymentEvent("test", e)).status).toBe("amount_mismatch");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PENDING_PAYMENT");
  });

  it("returns stock when unpaid orders are cancelled or expire", async () => {
    await makeRoot();
    const u = await customer();
    const p = await product({ stock: 5 });
    await addToCart(u.id, p.id, 2);
    const o1 = await createOrderFromCart(u.id, address);
    await cancelPendingOrder(o1.id, u.id, { userId: u.id });
    await addToCart(u.id, p.id, 3);
    await createOrderFromCart(u.id, address);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(2);
    expect(await expireStaleOrders(later(1))).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
  });
});

describe("commissions", () => {
  it("credits direct bonus and leg volume only after the hold period", async () => {
    await setPlan({ holdDays: 14, directBonusPercent: 10 });
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const c = await customer(a.referralCode);
    const p = await product({ priceMinor: 5000, pv: 100 });
    await buyAndPay(c.id, p.id, 2);

    expect(await matureOrders(new Date())).toBe(0);
    expect(await matureOrders(later(15))).toBe(1);
    expect(await matureOrders(later(15))).toBe(0); // idempotent

    const direct = await prisma.commission.findFirstOrThrow({ where: { userId: a.id, type: "DIRECT" } });
    expect(direct.amountMinor).toBe(1000);
    expect((await node(a.id)).personalPv).toBe(200); // customer volume lands on sponsor's node
    expect((await node(root.id)).leftCarryPv).toBe(200);
  });

  it("refund inside the hold window means no commission at all", async () => {
    await setPlan({ holdDays: 14 });
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const c = await customer(a.referralCode);
    const p = await product({ stock: 5 });
    const order = await buyAndPay(c.id, p.id);
    await refundOrder(order.id, root.id, { restock: true });
    expect(await matureOrders(later(30))).toBe(0);
    expect(await prisma.commission.count()).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(5);
  });

  it("refund after commissions claws back the direct bonus and volume", async () => {
    await setPlan({ holdDays: 0 });
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const c = await customer(a.referralCode);
    const p = await product();
    const order = await buyAndPay(c.id, p.id);
    await matureOrders(later(1));
    expect((await walletBalance(a.id)).availableMinor).toBe(500);
    await refundOrder(order.id, root.id, { restock: false });
    expect((await walletBalance(a.id)).availableMinor).toBe(0);
    expect((await node(root.id)).leftCarryPv).toBe(0);
  });

  it("pays binary only to qualified affiliates, once per period, with the cap", async () => {
    await setPlan({ holdDays: 0, pairUnitPv: 100, pairValueMinor: 1000, dailyCapMinor: 3000, requireDirectOnEachLeg: true });
    const root = await makeRoot();
    const s = await affiliate(root.referralCode, "LEFT", "sponsor");
    const l = await affiliate(s.referralCode, "LEFT");
    const r = await affiliate(s.referralCode, "RIGHT");
    const p = await product({ pv: 100, stock: 100 });
    await buyAndPay(l.id, p.id, 5);
    await buyAndPay(r.id, p.id, 4);
    await matureOrders(later(1));

    const run = await runBinary("2026-10-20", root.id);
    const pay = await prisma.commission.findFirstOrThrow({ where: { userId: s.id, type: "BINARY" } });
    expect(pay.amountMinor).toBe(3000); // 4 pairs = 4000, capped to 3000
    expect(run.flushedMinor).toBe(1000);
    const ns = await node(s.id);
    expect(ns.leftCarryPv).toBe(100);
    expect(ns.rightCarryPv).toBe(0);
    // Root has all 900 PV on its left only, so no pairs, and root isn't qualified anyway.
    expect(await prisma.commission.count({ where: { userId: root.id, type: "BINARY" } })).toBe(0);
    await expect(runBinary("2026-10-20", root.id)).rejects.toThrow(/already been run/);
  });

  it("an affiliate without a personal referral on each leg keeps volume but isn't paid", async () => {
    await setPlan({ holdDays: 0, requireDirectOnEachLeg: true });
    const root = await makeRoot();
    const s = await affiliate(root.referralCode, "LEFT");
    const l = await affiliate(s.referralCode, "LEFT");
    const r = await affiliate(root.referralCode, "LEFT"); // spills under s's left edge, not s's personal referral on the right
    const r2 = await affiliate(root.referralCode, "RIGHT");
    await prisma.affiliateNode.update({ where: { userId: s.id }, data: { leftCarryPv: 300, rightCarryPv: 300 } });
    await runBinary("p1", null);
    expect(await prisma.commission.count({ where: { userId: s.id } })).toBe(0);
    expect((await node(s.id)).leftCarryPv).toBe(300);
    void l; void r; void r2;
  });
});

describe("payouts", () => {
  it("never lets concurrent requests exceed the balance", async () => {
    await setPlan({ holdDays: 0, directBonusPercent: 50 });
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const c = await customer(a.referralCode);
    const p = await product({ priceMinor: 2000000, stock: 10 });
    await buyAndPay(c.id, p.id); // direct bonus 1,000,000 kobo
    await matureOrders(later(1));
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => requestPayout(a.id, { amountMinor: 600000, method: "BANK_TRANSFER", destination: "0123456789 Test Bank" })),
    );
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const payout = await prisma.payout.findFirstOrThrow({ where: { userId: a.id } });
    await expect(processPayout(payout.id, "PAY", root.id, "TX1")).rejects.toThrow();
    await processPayout(payout.id, "APPROVE", root.id);
    await processPayout(payout.id, "PAY", root.id, "TX1");
    expect((await walletBalance(a.id)).availableMinor).toBe(400000);
  });
});

describe("refunds and chargebacks from the gateway", () => {
  async function paidOrder(holdDays = 0) {
    await setPlan({ holdDays });
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const c = await customer(a.referralCode);
    const p = await product();
    const order = await buyAndPay(c.id, p.id);
    const pay = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    return { root, a, order, ref: pay.providerRef };
  }

  it("an open dispute blocks commissions until it is won", async () => {
    const { a, order, ref } = await paidOrder();
    await applyPaymentEvent("test", { eventId: "d1", type: "dispute.opened", providerRef: ref });
    expect(await matureOrders(later(1))).toBe(0);
    expect((await applyPaymentEvent("test", { eventId: "d2", type: "dispute.resolved", providerRef: ref, merchantLost: false })).status).toBe("dispute_won");
    expect(await matureOrders(later(1))).toBe(1);
    expect((await walletBalance(a.id)).availableMinor).toBeGreaterThan(0);
    void order;
  });

  it("a lost chargeback after commissions reverses them", async () => {
    const { a, order, ref } = await paidOrder();
    await matureOrders(later(1));
    expect((await walletBalance(a.id)).availableMinor).toBe(500);
    const r = await applyPaymentEvent("test", { eventId: "d3", type: "dispute.resolved", providerRef: ref, merchantLost: true });
    expect(r.status).toBe("charged_back");
    expect((await walletBalance(a.id)).availableMinor).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("REFUNDED");
  });

  it("a refund made in the gateway dashboard is recorded once", async () => {
    const { order, ref } = await paidOrder(14);
    const e = { eventId: "r1", type: "payment.refunded" as const, providerRef: ref, amountMinor: order.totalMinor };
    expect((await applyPaymentEvent("test", e)).status).toBe("refunded");
    expect((await applyPaymentEvent("test", { ...e, eventId: "r2" })).status).toBe("ignored");
    expect(await matureOrders(later(30))).toBe(0);
  });
});
