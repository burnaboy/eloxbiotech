import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/users";
import { DEFAULT_COMP_PLAN, saveSetting, type CompPlan } from "@/lib/settings";
import { hashPassword } from "@/lib/auth";
import { expect } from "vitest";
import { addToCart, applyPaymentEvent, createOrderFromCart, startPayment } from "@/lib/orders";
import { testProvider, buildTestEvent } from "@/lib/payments/test-provider";

export async function buyAndPay(userId: string, productId: string, qty = 1) {
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

export const later = (days: number) => new Date(Date.now() + days * 864e5);

export async function resetDb() {
  const tables = [
    "EmailVerificationToken", "PasswordResetToken", "EmailOutbox", "ContactMessage", "Testimonial", "SupportMessage", "SupportTicket",
    "ReturnRequest", "Notification", "Address", "Category",
    "AuditLog", "Setting", "CarryMovement", "PlacementRecord", "Payout", "Commission", "BinaryRun", "WebhookEvent", "Payment", "VolumeEntry",
    "OrderItem", "Order", "CartItem", "InventoryMovement", "ProductImage", "ProductVariant", "Product", "AffiliateNode", "LoginAttempt", "Session", "User",
  ];
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);
}

export async function setPlan(p: Partial<CompPlan>) {
  await saveSetting("compPlan", { ...DEFAULT_COMP_PLAN, ...p });
}

let n = 0;
export async function makeRoot() {
  const user = await prisma.user.create({
    data: { email: "root@test.dev", name: "Company", passwordHash: await hashPassword("x"), referralCode: "ROOT0001", role: "SUPER_ADMIN", emailVerifiedAt: new Date() },
  });
  await prisma.affiliateNode.create({ data: { userId: user.id, ancestorIds: [] } });
  return user;
}

async function verified<T extends { id: string }>(p: Promise<T>) {
  const u = await p;
  return prisma.user.update({ where: { id: u.id }, data: { emailVerifiedAt: new Date() } });
}

export async function affiliate(sponsorCode: string | undefined, leg?: "LEFT" | "RIGHT", name = `a${++n}`) {
  return verified(registerUser({
    name,
    email: `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`,
    password: "password123",
    referralCode: sponsorCode,
    leg,
    joinAsAffiliate: true,
  }));
}

export async function customer(sponsorCode?: string) {
  return verified(registerUser({
    name: `c${++n}`,
    email: `c${n}-${Math.random().toString(36).slice(2)}@test.dev`,
    password: "password123",
    referralCode: sponsorCode,
    joinAsAffiliate: false,
  }));
}

export async function product(over: Partial<{ priceMinor: number; pv: number; stock: number }> = {}) {
  const id = Math.random().toString(36).slice(2, 8);
  return prisma.product.create({
    data: { sku: `SKU-${id}`, slug: `p-${id}`, name: `Product ${id}`, description: "x", priceMinor: 5000, listPriceMinor: over.priceMinor ?? 5000, pv: 100, stock: 10, status: "ACTIVE", ...over },
  });
}

export const address = {
  shipName: "Test Buyer",
  shipPhone: "+15550001",
  shipLine1: "1 Test Street",
  shipCity: "Lagos",
  shipState: "Lagos",
  shipCountry: "Nigeria",
};

export function node(userId: string) {
  return prisma.affiliateNode.findUniqueOrThrow({ where: { userId } });
}
