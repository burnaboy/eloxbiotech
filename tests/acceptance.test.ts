/**
 * Release acceptance criteria (section 20) that the other test files don't already cover.
 * docs/ACCEPTANCE.md maps every criterion to the test that proves it.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { address, affiliate, bankAccount, buyAndPay, customer, later, makeRoot, product, resetDb, setPlan } from "./helpers";
import { registerUser } from "@/lib/users";
import { verifyPassword } from "@/lib/auth";
import { addToCart, createOrderFromCart, setCartQuantity } from "@/lib/orders";
import { applyPaymentEvent, startPayment } from "@/lib/payments/service";
import { matureOrders, setCommissionHold } from "@/lib/commissions";
import { refundOrder } from "@/lib/refunds";
import { adjustWallet, createPayoutBatch, failPayout, requestPayout, reviewPayout, settlePayout, walletBalance } from "@/lib/wallet";
import { publishPlan } from "@/lib/comp-plan";
import { DEFAULT_COMP_PLAN } from "@/lib/settings";
import { resetMfa } from "@/lib/mfa";
import { adjustStock } from "@/lib/inventory";
import { productFormSchema } from "@/lib/product-input";
import { reconcileLedger } from "@/lib/ledger";
import { deliverPendingEmails } from "@/lib/email";

beforeEach(async () => {
  await resetDb();
  await setPlan({});
});

/** Every non-root position: parent exists, depth and ancestry agree with the parent, one member per slot. */
async function treeProblems() {
  return prisma.$queryRaw<{ id: string; problem: string }[]>`
    SELECT n.id, 'path' AS problem FROM "AffiliateNode" n JOIN "AffiliateNode" p ON p.id = n."parentId"
      WHERE n.depth <> p.depth + 1 OR n."ancestorIds" <> p."ancestorIds" || p.id OR n.position IS NULL
    UNION ALL SELECT n.id, 'orphan' FROM "AffiliateNode" n WHERE n."parentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AffiliateNode" p WHERE p.id = n."parentId")
    UNION ALL SELECT n.id, 'cycle' FROM "AffiliateNode" n WHERE n.id = ANY(n."ancestorIds")
    UNION ALL SELECT min(n.id), 'slot' FROM "AffiliateNode" n WHERE n."parentId" IS NOT NULL GROUP BY n."parentId", n.position HAVING count(*) > 1
    UNION ALL SELECT 'roots', 'roots' FROM "AffiliateNode" WHERE "parentId" IS NULL HAVING count(*) <> 1
    UNION ALL SELECT u.id, 'affiliate without position' FROM "User" u WHERE u.role = 'AFFILIATE' AND NOT EXISTS (SELECT 1 FROM "AffiliateNode" n WHERE n."userId" = u.id)`;
}

describe("authentication", () => {
  it("registers a new member with a hashed password, and refuses the same email in any letter case", async () => {
    const root = await makeRoot();
    const u = await registerUser({ name: "Ngozi Okafor", email: "Ngozi@Example.com", password: "correct horse battery 9", referralCode: root.referralCode });
    expect(u.email).toBe("ngozi@example.com");
    expect(u.role).toBe("CUSTOMER");
    expect(u.sponsorId).toBe(root.id);
    expect(u.passwordHash).not.toContain("correct horse");
    expect(await verifyPassword("correct horse battery 9", u.passwordHash)).toBe(true);
    await expect(registerUser({ name: "Someone Else", email: "NGOZI@example.com", password: "another password 1" })).rejects.toThrow(/already/i);
    expect(await prisma.user.count({ where: { email: "ngozi@example.com" } })).toBe(1);
  });

  it("every admin action checks the admin's role and permission before doing anything", () => {
    const src = readFileSync("src/app/admin/actions.ts", "utf8");
    const actions = src.split(/\nexport async function /).slice(1);
    expect(actions.length).toBeGreaterThan(40);
    for (const a of actions) {
      const name = a.slice(0, a.indexOf("("));
      const body = a.slice(a.indexOf("{") + 1).trimStart();
      // The first statement must be the guard: `await act(path, guard, ...)` or `const admin = await requireAdmin/requireSuperAdmin(...)`.
      expect(/^(await act\(|const admin = await require(Super)?Admin\()/.test(body), name).toBe(true);
    }
    expect(readFileSync("src/app/admin/layout.tsx", "utf8")).toMatch(/requireAdmin\(/);
    for (const f of ["src/app/admin/export/[report]/route.ts", "src/app/admin/payouts/batches/[id]/export/route.ts"]) {
      expect(readFileSync(f, "utf8"), f).toMatch(/requireAdmin|requireSuperAdmin|canAccess/);
    }
  });
});

describe("binary network", () => {
  it("keeps valid placement for every member through mixed and simultaneous sign-ups", async () => {
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const b = await affiliate(root.referralCode, "RIGHT");
    await Promise.all([
      ...Array.from({ length: 6 }, () => affiliate(a.referralCode).catch(() => null)),
      ...Array.from({ length: 6 }, (_, i) => affiliate(b.referralCode, i % 2 ? "LEFT" : "RIGHT").catch(() => null)),
      customer(a.referralCode),
    ]);
    expect(await prisma.affiliateNode.count()).toBeGreaterThan(8);
    expect(await treeProblems()).toEqual([]);
  });

  it("the database refuses a second child on a leg, a cycle, a path that disagrees with the parent, and a second root", async () => {
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const rootNode = await prisma.affiliateNode.findUniqueOrThrow({ where: { userId: root.id } });
    const extra = await customer(root.referralCode);
    // Same leg twice.
    await expect(prisma.affiliateNode.create({ data: { userId: extra.id, parentId: rootNode.id, position: "LEFT", depth: 1, ancestorIds: [rootNode.id] } })).rejects.toThrow();
    // Its own ancestor (a cycle).
    const id = randomUUID();
    await expect(prisma.affiliateNode.create({ data: { id, userId: extra.id, parentId: rootNode.id, position: "RIGHT", depth: 1, ancestorIds: [id] } })).rejects.toThrow();
    // Ancestry or depth that doesn't follow from the parent.
    const aNode = await prisma.affiliateNode.findUniqueOrThrow({ where: { userId: a.id } });
    await expect(prisma.affiliateNode.create({ data: { userId: extra.id, parentId: aNode.id, position: "LEFT", depth: 2, ancestorIds: [aNode.id] } })).rejects.toThrow(/path/);
    await expect(prisma.affiliateNode.create({ data: { userId: extra.id, parentId: aNode.id, position: "LEFT", depth: 5, ancestorIds: [rootNode.id, aNode.id] } })).rejects.toThrow(/path/);
    // A second root.
    await expect(prisma.affiliateNode.create({ data: { userId: extra.id, ancestorIds: [] } })).rejects.toThrow();
    // Moving an existing member, or giving them a parent that's their own descendant.
    await expect(prisma.affiliateNode.update({ where: { id: rootNode.id }, data: { parentId: aNode.id, position: "LEFT" } })).rejects.toThrow(/cannot be changed/);
    expect(await treeProblems()).toEqual([]);
  });
});

describe("e-commerce", () => {
  it("rejects invalid quantities and anything beyond available stock", async () => {
    const root = await makeRoot();
    const c = await customer(root.referralCode);
    const p = await product({ stock: 3 });
    for (const q of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 100]) {
      await expect(setCartQuantity(c.id, p.id, q), String(q)).rejects.toThrow(/Invalid quantity/);
    }
    await expect(setCartQuantity(c.id, p.id, 4)).rejects.toThrow(/Only 3 left/);
    await addToCart(c.id, p.id, 3);
    await expect(addToCart(c.id, p.id, 1)).rejects.toThrow(/Only 3 left/);
    await expect(prisma.cartItem.updateMany({ where: { userId: c.id }, data: { quantity: 0 } })).rejects.toThrow();
  });

  it("works out the order total on the server from database prices", async () => {
    const root = await makeRoot();
    const c = await customer(root.referralCode);
    const p1 = await product({ priceMinor: 5000, listPriceMinor: 5000 } as never);
    const p2 = await product({ priceMinor: 7000, listPriceMinor: 7000 } as never);
    await addToCart(c.id, p1.id, 2);
    await addToCart(c.id, p2.id, 1);
    // A price change after adding to the cart is what gets charged.
    await prisma.product.update({ where: { id: p2.id }, data: { priceMinor: 7500, listPriceMinor: 7500 } });
    const order = await createOrderFromCart(c.id, address);
    const items = await prisma.orderItem.findMany({ where: { orderId: order.id } });
    expect(items.map((i) => i.unitPriceMinor).sort()).toEqual([5000, 7500]);
    // 2 × 5,000 + 1 × 7,500 + flat delivery 250,000 (below the free-delivery threshold, VAT off).
    expect(order.subtotalMinor).toBe(17500);
    expect(order.shippingMinor).toBe(250000);
    expect(order.totalMinor).toBe(267500);
  });

  it("rejects invalid prices in the product form and in the database", async () => {
    const base = { name: "Shea butter", slug: "shea", sku: "SHEA-1", description: "Pure shea butter", categoryId: "", status: "ACTIVE", featured: false, salePrice: "", saleStartsAt: "", saleEndsAt: "", pv: "10", lowStockThreshold: "5", shippable: true, weightGrams: "", lengthCm: "", widthCm: "", heightCm: "", metaTitle: "", metaDescription: "", attributes: "" } as const;
    for (const price of ["-100", "abc", "1.234", "", "1e5"]) expect(productFormSchema.safeParse({ ...base, price }).success, price).toBe(false);
    expect(productFormSchema.safeParse({ ...base, price: "100", salePrice: "150" }).success).toBe(false);
    expect(productFormSchema.safeParse({ ...base, price: "12500.50" }).success).toBe(true);
    const p = await product();
    await expect(prisma.product.update({ where: { id: p.id }, data: { priceMinor: -1 } })).rejects.toThrow();
    await expect(prisma.product.update({ where: { id: p.id }, data: { salePriceMinor: 99999 } })).rejects.toThrow();
  });
});

describe("payments and commissions", () => {
  it("a failed transaction creates no sale, commission, volume or wallet entry", async () => {
    await setPlan({ holdDays: 0 });
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const c = await customer(a.referralCode);
    const p = await product({ stock: 2 });
    await addToCart(c.id, p.id, 1);
    const order = await createOrderFromCart(c.id, address);
    await startPayment(order.id, c.id);
    const pay = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    const r = await applyPaymentEvent("test", { eventId: "evt_fail", type: "payment.failed", providerRef: pay.providerRef, amountMinor: order.totalMinor, currency: "NGN", reason: "Declined" });
    expect(r.status).toBe("failed");
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.paidAt).toBeNull();
    expect(o.paidPaymentId).toBeNull();
    expect(o.status).toBe("PENDING_PAYMENT");
    expect(await matureOrders(later(30))).toBe(0);
    expect(await prisma.commission.count()).toBe(0);
    expect(await prisma.volumeEntry.count()).toBe(0);
    expect(await prisma.ledgerEntry.count()).toBe(0);
  });

  it("processing the same sale many times at once creates one commission and one ledger posting", async () => {
    await setPlan({ holdDays: 0, directRateBps: 1000 });
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const c = await customer(a.referralCode);
    const p = await product({ priceMinor: 10000, listPriceMinor: 10000 } as never);
    const order = await buyAndPay(c.id, p.id);
    const pay = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
    // Webhook retries, the browser callback and reconciliation all arriving together.
    await Promise.all(Array.from({ length: 5 }, (_, i) => applyPaymentEvent("test", { eventId: `evt_dup_${i}`, type: "payment.succeeded", providerRef: pay.providerRef, amountMinor: order.totalMinor, currency: "NGN" })));
    const runs = await Promise.all(Array.from({ length: 4 }, () => matureOrders(later(1))));
    expect(runs.reduce((s, n) => s + n, 0)).toBe(1);
    expect(await prisma.order.count()).toBe(1);
    const comms = await prisma.commission.findMany({ where: { userId: a.id } });
    expect(comms.map((x) => x.amountMinor)).toEqual([1000]);
    expect(await prisma.ledgerEntry.count({ where: { userId: a.id, commissionId: comms[0].id, type: "COMMISSION_EARNED" } })).toBe(1);
    expect((await reconcileLedger()).ok).toBe(true);
  });

  it("a refund after the commission was credited posts a reversal rather than editing history", async () => {
    await setPlan({ holdDays: 0, directRateBps: 1000 });
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const c = await customer(a.referralCode);
    const p = await product({ priceMinor: 10000, listPriceMinor: 10000 } as never);
    const order = await buyAndPay(c.id, p.id);
    await matureOrders(later(1));
    const before = await prisma.ledgerEntry.findMany({ where: { userId: a.id }, orderBy: { createdAt: "asc" } });
    await refundOrder(order.id, root.id, { reason: "Customer returned the item" });
    const after = await prisma.ledgerEntry.findMany({ where: { userId: a.id }, orderBy: { createdAt: "asc" } });
    expect(after.slice(0, before.length)).toEqual(before); // earlier entries unchanged
    expect(after.length).toBeGreaterThan(before.length);
    expect((await walletBalance(a.id)).availableMinor).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { userId: a.id, type: "COMMISSION_REVERSED" } })).toBeGreaterThan(0);
  });
});

describe("wallet and audit", () => {
  it("records an audit entry with the acting admin for every privileged adjustment", async () => {
    await setPlan({ holdDays: 0 });
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const c = await customer(a.referralCode);
    const p = await product({ priceMinor: 10000, listPriceMinor: 10000, stock: 20 } as never);
    const o1 = await buyAndPay(c.id, p.id);
    await matureOrders(later(1));
    const comm = await prisma.commission.findFirstOrThrow({ where: { userId: a.id } });
    await buyAndPay(c.id, p.id);

    await adjustWallet(a.id, { amountMinor: 1_000_000, reason: "Opening balance for the test" }, root.id);
    await setCommissionHold(comm.id, true, root.id, "Checking for self-purchase");
    await setCommissionHold(comm.id, false, root.id, "Checked, released");
    await bankAccount(a.id);
    const w1 = await requestPayout(a.id, { amountMinor: 500000 });
    await reviewPayout(w1.id, "APPROVE", root.id);
    await createPayoutBatch([w1.id], root.id);
    await failPayout(w1.id, root.id, "Account name mismatch");
    await refundOrder(o1.id, root.id, { reason: "Customer returned the item" });
    await publishPlan({ ...DEFAULT_COMP_PLAN, directRateBps: 1200 }, root.id, "Approved by the board");
    await resetMfa(a.id, root.id);
    await adjustStock({ productId: p.id, variantId: null, delta: 5, reason: "RESTOCK", note: "Delivery from supplier", actorId: root.id });

    const logged = new Set((await prisma.auditLog.findMany({ where: { actorId: root.id } })).map((x) => x.action));
    for (const action of ["wallet.correction", "commission.hold", "commission.release", "payout.approved", "payoutBatch.create", "payout.failed", "order.refund", "settings.compPlan", "mfa.reset", "inventory.adjust"]) {
      expect(logged, action).toContain(action);
    }
  });

  it("a payout is complete only with provider evidence, and reconciles to it", async () => {
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    await adjustWallet(a.id, { amountMinor: 1_000_000, reason: "Opening balance for the test" }, root.id);
    await bankAccount(a.id);
    const w = await requestPayout(a.id, { amountMinor: 600000 });
    await reviewPayout(w.id, "APPROVE", root.id);
    await createPayoutBatch([w.id], root.id);
    await expect(settlePayout(w.id, root.id, { reference: "", settledAt: new Date(), evidence: "Statement line" })).rejects.toThrow();
    await expect(settlePayout(w.id, root.id, { reference: "NIP-9", settledAt: new Date(), evidence: "" })).rejects.toThrow();
    await settlePayout(w.id, root.id, { reference: "NIP-9", settledAt: new Date(), evidence: "Bank statement 20 Oct, debit ₦6,000" });
    const paid = await prisma.payout.findUniqueOrThrow({ where: { id: w.id } });
    expect([paid.status, paid.reference]).toEqual(["PAID", "NIP-9"]);
    expect(paid.settledAt).not.toBeNull();
    expect((await walletBalance(a.id)).paidOutMinor).toBe(600000);
    expect((await reconcileLedger()).ok).toBe(true);
  });
});

describe("operations", () => {
  it("overlapping runs of the scheduled jobs don't double up", async () => {
    await setPlan({ holdDays: 0 });
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const c = await customer(a.referralCode);
    const p = await product({ stock: 20 });
    for (let i = 0; i < 3; i++) await buyAndPay(c.id, p.id);
    const matured = await Promise.all(Array.from({ length: 4 }, () => matureOrders(later(1))));
    expect(matured.reduce((s, n) => s + n, 0)).toBe(3);

    await prisma.emailOutbox.createMany({ data: Array.from({ length: 12 }, (_, i) => ({ to: `m${i}@test.dev`, subject: "Hello", body: "x" })) });
    const queued = await prisma.emailOutbox.count({ where: { sentAt: null } });
    const emails = await Promise.all(Array.from({ length: 4 }, () => deliverPendingEmails()));
    expect(emails.reduce((s, n) => s + n, 0)).toBe(queued); // each email sent exactly once
    expect(await prisma.emailOutbox.count({ where: { sentAt: null } })).toBe(0);
    expect(await prisma.commission.count({ where: { userId: a.id } })).toBe(3);
    expect((await reconcileLedger()).ok).toBe(true);
  });
});

describe("payment reconciliation with Paystack", () => {
  it("finds payments that differ between Paystack and our records, both ways, across pages", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_dummy";
    const { reconcileGateway } = await import("@/lib/payments/gateway-reconciliation");
    const root = await makeRoot();
    const c = await customer(root.referralCode);
    const p = await product({ stock: 50 });
    // Four orders recorded with Paystack payments in various states.
    const pays = [];
    for (const [ref, status, amount] of [["R-OK", "SUCCEEDED", 7500], ["R-PENDING", "PENDING", 7500], ["R-AMOUNT", "SUCCEEDED", 7500], ["R-MISSING", "SUCCEEDED", 7500]] as const) {
      await addToCart(c.id, p.id, 1);
      const o = await createOrderFromCart(c.id, address);
      pays.push(await prisma.payment.create({ data: { orderId: o.id, provider: "paystack", providerRef: ref, status, amountMinor: amount, currency: "NGN" } }));
    }
    // Paystack's side: 101 successful transactions over two pages (100 unrelated ones), one we've never seen.
    const gateway = [
      { id: 1, reference: "R-OK", status: "success", amount: 7500, currency: "NGN" },
      { id: 2, reference: "R-PENDING", status: "success", amount: 7500, currency: "NGN" },
      { id: 3, reference: "R-AMOUNT", status: "success", amount: 7000, currency: "NGN" },
      { id: 4, reference: "R-UNKNOWN", status: "success", amount: 9900, currency: "NGN" },
      ...Array.from({ length: 97 }, (_, i) => ({ id: 100 + i, reference: `R-OTHER-${i}`, status: "success", amount: 100, currency: "NGN" })),
    ];
    const urls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      urls.push(url);
      expect(init?.method ?? "GET").toBe("GET"); // read-only
      const page = Number(new URL(url).searchParams.get("page"));
      return new Response(JSON.stringify({ status: true, message: "ok", data: gateway.slice((page - 1) * 100, page * 100) }));
    }) as typeof fetch;
    const r = await reconcileGateway(new Date(Date.now() - 864e5), new Date(Date.now() + 60e3), { fetchImpl });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("status=success");
    const kinds = Object.fromEntries(r.problems.filter((x) => !x.reference.startsWith("R-OTHER")).map((x) => [x.reference, x.kind]));
    expect(kinds).toEqual({ "R-PENDING": "not_recorded_paid", "R-AMOUNT": "amount_mismatch", "R-UNKNOWN": "unknown_here", "R-MISSING": "not_paid_at_gateway" });
    expect(r.ok).toBe(false);
    expect(r.gatewayCount).toBe(101);
    expect(await prisma.auditLog.count({ where: { action: "gateway.reconcile" } })).toBe(1);
    // Nothing was changed: reconciliation only reports.
    for (const pay of pays) expect((await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).status).toBe(pay.status);
  });
});
