import { prisma } from "@/lib/db";
import { registerUser } from "@/lib/users";
import { DEFAULT_COMP_PLAN, saveSetting, type CompPlan } from "@/lib/settings";
import { hashPassword } from "@/lib/auth";

export async function resetDb() {
  const tables = [
    "AuditLog", "Setting", "Payout", "Commission", "BinaryRun", "WebhookEvent", "Payment", "VolumeEntry",
    "OrderItem", "Order", "CartItem", "InventoryMovement", "Product", "AffiliateNode", "LoginAttempt", "Session", "User",
  ];
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t}"`).join(", ")} CASCADE`);
}

export async function setPlan(p: Partial<CompPlan>) {
  await saveSetting("compPlan", { ...DEFAULT_COMP_PLAN, ...p });
}

let n = 0;
export async function makeRoot() {
  const user = await prisma.user.create({
    data: { email: "root@test.dev", name: "Company", passwordHash: await hashPassword("x"), referralCode: "ROOT0001", role: "ADMIN" },
  });
  await prisma.affiliateNode.create({ data: { userId: user.id, ancestorIds: [] } });
  return user;
}

export async function affiliate(sponsorCode: string | undefined, leg?: "LEFT" | "RIGHT", name = `a${++n}`) {
  return registerUser({
    name,
    email: `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.dev`,
    password: "password123",
    referralCode: sponsorCode,
    leg,
    joinAsAffiliate: true,
  });
}

export async function customer(sponsorCode?: string) {
  return registerUser({
    name: `c${++n}`,
    email: `c${n}-${Math.random().toString(36).slice(2)}@test.dev`,
    password: "password123",
    referralCode: sponsorCode,
    joinAsAffiliate: false,
  });
}

export async function product(over: Partial<{ priceMinor: number; pv: number; stock: number }> = {}) {
  const id = Math.random().toString(36).slice(2, 8);
  return prisma.product.create({
    data: { sku: `SKU-${id}`, slug: `p-${id}`, name: `Product ${id}`, description: "x", priceMinor: 5000, pv: 100, stock: 10, ...over },
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
