import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { address, buyAndPay, customer, makeRoot, product, resetDb, setPlan } from "./helpers";
import { addToCart, cancelPendingOrder, createOrderFromCart, getCart, shippingFor, updateFulfilment } from "@/lib/orders";
import { refundOrder } from "@/lib/refunds";
import { lowestPrice, parseAttributes, refreshListPrice, unitPrice } from "@/lib/catalog";
import { adjustStock, receiveReturnedItems } from "@/lib/inventory";
import { formatMoney, signedMinor, toMinor } from "@/lib/money";
import { processImage } from "@/lib/images";
import { assertSafeKey, getStorage, readLocal } from "@/lib/storage";

beforeEach(async () => {
  await resetDb();
  await setPlan({});
});

const base = { priceMinor: 10000, salePriceMinor: null as number | null, saleStartsAt: null as Date | null, saleEndsAt: null as Date | null, pv: 10 };
const day = 864e5;

describe("money", () => {
  it("parses and formats amounts without floating point", () => {
    expect(toMinor("12,500.5")).toBe(1250050);
    expect(toMinor("0.07")).toBe(7);
    expect(toMinor("19.99")).toBe(1999);
    expect(() => toMinor("1e5")).toThrow();
    expect(() => toMinor("12.345")).toThrow();
    expect(() => toMinor("-5")).toThrow();
    expect(signedMinor("-1500")).toBe(-150000);
    expect(formatMoney(123456789)).toBe("₦1,234,567.89");
    expect(formatMoney(-5)).toBe("-₦0.05");
  });
});

describe("pricing", () => {
  it("applies a sale only inside its window and only below the regular price", () => {
    const now = new Date();
    expect(unitPrice({ ...base, salePriceMinor: 8000 }, null, now)).toEqual({ unitMinor: 8000, compareAtMinor: 10000, pv: 10 });
    expect(unitPrice({ ...base, salePriceMinor: 8000, saleStartsAt: new Date(+now + day) }, null, now).unitMinor).toBe(10000);
    expect(unitPrice({ ...base, salePriceMinor: 8000, saleEndsAt: new Date(+now - 1) }, null, now).unitMinor).toBe(10000);
    expect(unitPrice({ ...base, salePriceMinor: 12000 }, null, now).unitMinor).toBe(10000);
  });

  it("lets options override price and PV, inheriting the product sale only when they don't set a price", () => {
    const p = { ...base, salePriceMinor: 9000 };
    expect(unitPrice(p, { priceMinor: null, salePriceMinor: null, pv: null })).toEqual({ unitMinor: 9000, compareAtMinor: 10000, pv: 10 });
    expect(unitPrice(p, { priceMinor: 20000, salePriceMinor: null, pv: 25 })).toEqual({ unitMinor: 20000, compareAtMinor: null, pv: 25 });
    expect(unitPrice(p, { priceMinor: 20000, salePriceMinor: 15000, pv: null }).unitMinor).toBe(15000);
    expect(lowestPrice(p, [{ priceMinor: 20000, salePriceMinor: null, pv: null, active: true }, { priceMinor: 5000, salePriceMinor: null, pv: null, active: false }]).unitMinor).toBe(20000);
  });

  it("charges shipping by weight on top of the flat rate, free over the threshold", () => {
    const shop = { flatShippingMinor: 1000, perKgShippingMinor: 200, freeShippingOverMinor: 50000 };
    expect(shippingFor(10000, 2500, shop)).toBe(1600);
    expect(shippingFor(50000, 2500, shop)).toBe(0);
    expect(shippingFor(0, 0, shop)).toBe(0);
  });

  it("keeps product facts small and plain", () => {
    expect(parseAttributes("Brand: Acme\nnot a pair\n: empty\nNAFDAC No.: A1-23")).toEqual({ Brand: "Acme", "NAFDAC No.": "A1-23" });
  });
});

describe("cart and checkout use server prices", () => {
  it("charges the price in the database at checkout, including a sale that started after adding to cart", async () => {
    const c = await customer();
    const p = await product({ priceMinor: 10000, stock: 5 });
    await addToCart(c.id, p.id, 2);
    await prisma.product.update({ where: { id: p.id }, data: { salePriceMinor: 7000 } });
    const order = await createOrderFromCart(c.id, address);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item.unitPriceMinor).toBe(7000);
    expect(item.listPriceMinor).toBe(10000);
    expect(order.subtotalMinor).toBe(14000);
  });

  it("requires an option for products that have options and reserves that option's stock", async () => {
    const c = await customer();
    const p = await product({ priceMinor: 10000, stock: 0 });
    const v = await prisma.productVariant.create({ data: { productId: p.id, sku: "V-L", name: "Large", priceMinor: 15000, pv: 30, stock: 3 } });
    await expect(addToCart(c.id, p.id, 1)).rejects.toThrow(/choose an option/i);
    await addToCart(c.id, p.id, 2, v.id);
    const cart = await getCart(c.id);
    expect(cart.subtotalMinor).toBe(30000);
    expect(cart.totalPv).toBe(60);
    const order = await createOrderFromCart(c.id, address);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: v.id } })).stock).toBe(1);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item).toMatchObject({ variantId: v.id, variantName: "Large", sku: "V-L", unitPriceMinor: 15000, pv: 30 });

    await cancelPendingOrder(order.id, null);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: v.id } })).stock).toBe(3);
    const moves = await prisma.inventoryMovement.findMany({ where: { variantId: v.id }, orderBy: { createdAt: "asc" } });
    expect(moves.map((m) => [m.reason, m.delta, m.balance])).toEqual([["SALE", -2, 1], ["RELEASE", 2, 3]]);
  });

  it("refuses draft, archived and undeliverable products", async () => {
    const c = await customer();
    const draft = await product({ stock: 5 });
    await prisma.product.update({ where: { id: draft.id }, data: { status: "DRAFT" } });
    await expect(addToCart(c.id, draft.id, 1)).rejects.toThrow(/not available/);
    const p = await product({ stock: 5 });
    await addToCart(c.id, p.id, 1);
    await prisma.product.update({ where: { id: p.id }, data: { shippable: false } });
    await expect(createOrderFromCart(c.id, address)).rejects.toThrow(/delivered/);
    expect(await prisma.order.count()).toBe(0);
  });

  it("never oversells the last unit, even with simultaneous checkouts", async () => {
    const p = await product({ stock: 1 });
    const buyers = await Promise.all([customer(), customer(), customer()]);
    for (const b of buyers) await addToCart(b.id, p.id, 1);
    const results = await Promise.allSettled(buyers.map((b) => createOrderFromCart(b.id, address)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(0);
    await expect(prisma.product.update({ where: { id: p.id }, data: { stock: -1 } })).rejects.toThrow();
  });
});

describe("inventory", () => {
  it("requires a note, refuses negative stock and records the balance", async () => {
    const root = await makeRoot();
    const p = await product({ stock: 2 });
    await expect(adjustStock({ productId: p.id, variantId: null, delta: 5, reason: "RESTOCK", note: "", actorId: root.id })).rejects.toThrow(/note/);
    await expect(adjustStock({ productId: p.id, variantId: null, delta: -3, reason: "ADJUSTMENT", note: "count", actorId: root.id })).rejects.toThrow(/below zero/);
    expect(await adjustStock({ productId: p.id, variantId: null, delta: 8, reason: "RESTOCK", note: "Invoice 42", actorId: root.id })).toBe(10);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "inventory.adjust" } });
    expect(audit.actorId).toBe(root.id);
  });

  it("alerts staff once when stock gets low and again only after a restock", async () => {
    const root = await makeRoot();
    const p = await product({ stock: 6 });
    await prisma.product.update({ where: { id: p.id }, data: { lowStockThreshold: 5 } });
    await adjustStock({ productId: p.id, variantId: null, delta: -1, reason: "ADJUSTMENT", note: "damaged", actorId: root.id });
    await adjustStock({ productId: p.id, variantId: null, delta: -1, reason: "ADJUSTMENT", note: "damaged", actorId: root.id });
    expect(await prisma.notification.count({ where: { userId: root.id, title: "Low stock" } })).toBe(1);
    await adjustStock({ productId: p.id, variantId: null, delta: 10, reason: "RESTOCK", note: "supplier", actorId: root.id });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).lowStockAlertedAt).toBeNull();
    await adjustStock({ productId: p.id, variantId: null, delta: -10, reason: "ADJUSTMENT", note: "recount", actorId: root.id });
    expect(await prisma.notification.count({ where: { userId: root.id, title: "Low stock" } })).toBe(2);
  });

  it("restocks an unshipped refund automatically, but shipped goods only when received", async () => {
    await setPlan({ holdDays: 14 });
    const root = await makeRoot();
    const c = await customer(root.referralCode);
    const p = await product({ stock: 10 });

    const unshipped = await buyAndPay(c.id, p.id, 2);
    await refundOrder(unshipped.id, root.id, { reason: "test" });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(10);

    const shipped = await buyAndPay(c.id, p.id, 3);
    await updateFulfilment(shipped.id, "SHIPPED", root.id);
    await refundOrder(shipped.id, root.id, { reason: "test" });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(7);

    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: shipped.id } });
    await expect(receiveReturnedItems(shipped.id, [{ orderItemId: item.id, restock: 3, writeOff: 1 }], root.id)).rejects.toThrow(/Only 3/);
    await receiveReturnedItems(shipped.id, [{ orderItemId: item.id, restock: 2, writeOff: 1 }], root.id, "one box crushed");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: p.id } })).stock).toBe(9);
    await expect(receiveReturnedItems(shipped.id, [{ orderItemId: item.id, restock: 1, writeOff: 0 }], root.id)).rejects.toThrow(/Only 0/);
    expect(await prisma.inventoryMovement.count({ where: { orderId: shipped.id, reason: "RETURN_WRITE_OFF" } })).toBe(1);
  });
});

describe("restricted data and images", () => {
  it("leaves cost prices out of queries unless asked for", async () => {
    const p = await product();
    await prisma.product.update({ where: { id: p.id }, data: { costPriceMinor: 2000 } });
    const plain = await prisma.product.findUniqueOrThrow({ where: { id: p.id } });
    expect("costPriceMinor" in plain).toBe(false);
    const withCost = await prisma.product.findUniqueOrThrow({ where: { id: p.id }, omit: { costPriceMinor: false } });
    expect(withCost.costPriceMinor).toBe(2000);
  });

  it("keeps the list price used for sorting in step with the cheapest option", async () => {
    const p = await product({ priceMinor: 10000 });
    await prisma.productVariant.create({ data: { productId: p.id, sku: "C1", name: "Small", priceMinor: 6000, stock: 1 } });
    expect(await refreshListPrice(prisma, p.id)).toBe(6000);
  });

  it("accepts real images only and re-encodes them without metadata", async () => {
    await expect(processImage(Buffer.from("<svg onload=alert(1)>"))).rejects.toThrow(/JPEG, PNG or WebP/);
    await expect(processImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]))).rejects.toThrow(/couldn't be read/);
    const jpeg = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#c00" } })
      .jpeg().withMetadata({ exif: { IFD0: { Copyright: "secret", Artist: "someone" } } }).toBuffer();
    const out = await processImage(jpeg);
    expect([out.width, out.height]).toEqual([2000, 1000]);
    const meta = await sharp(out.body).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
  });

  it("stores files only under safe, server-made keys", async () => {
    process.env.UPLOAD_DIR = await mkdtemp(path.join(os.tmpdir(), "uploads-"));
    expect(() => assertSafeKey("../etc/passwd.webp")).toThrow();
    expect(() => assertSafeKey("products/x/a.html")).toThrow();
    const url = await getStorage().put("products/abc/test.webp", Buffer.from("x"), "image/webp");
    expect(url).toBe("/media/products/abc/test.webp");
    expect((await readLocal("products/abc/test.webp"))?.toString()).toBe("x");
    expect(await readLocal("products/../../secret.webp")).toBeNull();
  });
});
