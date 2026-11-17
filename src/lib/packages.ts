import { prisma } from "./db";

/*
 * Membership packages are ordinary shop products placed in the "packages" category, so they are bought,
 * paid for, refunded and commissioned through the normal checkout. A member's current package is the
 * most expensive package they have bought in an order that was paid and not fully refunded.
 */
export const PACKAGES_CATEGORY = "packages";

const OWNED = ["PAID", "PROCESSING", "SHIPPED", "DELIVERED", "PARTIALLY_REFUNDED"] as const;

export async function packagesFor(userId: string) {
  const [list, owned] = await Promise.all([
    prisma.product.findMany({
      where: { status: "ACTIVE", category: { slug: PACKAGES_CATEGORY } },
      select: { id: true, slug: true, name: true, description: true, listPriceMinor: true, pv: true, stock: true },
      orderBy: { listPriceMinor: "asc" },
    }),
    prisma.orderItem.findMany({
      where: { order: { userId, status: { in: [...OWNED] } }, product: { category: { slug: PACKAGES_CATEGORY } } },
      select: { productId: true, quantity: true, refundedQty: true },
    }),
  ]);
  const ownedIds = new Set(owned.filter((i) => i.quantity > i.refundedQty).map((i) => i.productId));
  const current = [...list].reverse().find((p) => ownedIds.has(p.id)) ?? null;
  return { list, current };
}
