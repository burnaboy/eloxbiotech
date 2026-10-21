/**
 * Seeds the minimum a fresh install needs: a super administrator (who is also the top of the network),
 * product categories and, outside production, clearly-labelled sample products. Safe to run more than once.
 * Set SEED_DEMO=1 to also create demo members for local testing (never in production).
 */
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hashPassword, randomCode } from "../src/lib/auth";

const prisma = new PrismaClient();

const CATEGORIES = [
  { name: "Health & Wellness", slug: "health-wellness", sortOrder: 1 },
  { name: "Personal Care", slug: "personal-care", sortOrder: 2 },
  { name: "Home & Kitchen", slug: "home-kitchen", sortOrder: 3 },
  { name: "Beverages", slug: "beverages", sortOrder: 4 },
];

const PRODUCTS = [
  { sku: "SAMPLE-001", name: "Daily Multivitamin, 60 tablets", cat: "health-wellness", price: 12500, pv: 25, stock: 120, featured: true },
  { sku: "SAMPLE-002", name: "Omega-3 Fish Oil, 90 softgels", cat: "health-wellness", price: 18000, pv: 35, stock: 80, featured: true },
  { sku: "SAMPLE-003", name: "Shea Butter Body Lotion, 400 ml", cat: "personal-care", price: 7500, pv: 15, stock: 200, featured: true },
  { sku: "SAMPLE-004", name: "Herbal Toothpaste, 2-pack", cat: "personal-care", price: 3500, pv: 7, stock: 300 },
  { sku: "SAMPLE-005", name: "Stainless Steel Water Bottle, 750 ml", cat: "home-kitchen", price: 9500, pv: 18, stock: 60, featured: true },
  { sku: "SAMPLE-006", name: "Non-stick Frying Pan, 28 cm", cat: "home-kitchen", price: 22000, pv: 40, stock: 25 },
  { sku: "SAMPLE-007", name: "Moringa Green Tea, 25 bags", cat: "beverages", price: 4500, pv: 9, stock: 150 },
  { sku: "SAMPLE-008", name: "Hibiscus (Zobo) Tea Blend, 250 g", cat: "beverages", price: 5000, pv: 10, stock: 4 },
];

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_DEMO === "1") throw new Error("Refusing to seed demo members in production.");

  const email = (process.env.SEED_ADMIN_EMAIL ?? "admin@eloxbiotech.local").toLowerCase();
  let admin = await prisma.user.findUnique({ where: { email } });
  if (!admin) {
    const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(12).toString("base64url");
    admin = await prisma.user.create({
      data: {
        email, name: "Company Account", role: "SUPER_ADMIN", referralCode: "COMPANY1", emailVerifiedAt: new Date(),
        passwordHash: await hashPassword(password),
      },
    });
    console.log(`Super admin created: ${email}`);
    if (!process.env.SEED_ADMIN_PASSWORD) console.log(`Temporary password (change it after first sign-in): ${password}`);
    console.log("You'll be asked to set up two-step verification on first visit to /admin.");
  }
  if (!(await prisma.affiliateNode.findFirst({ where: { parentId: null } }))) {
    await prisma.affiliateNode.create({ data: { userId: admin.id, ancestorIds: [] } });
  }

  // Sample products are development fixtures. In a production build (staging and production) they are
  // only created with SEED_SAMPLE_PRODUCTS=1, and never in the real production environment.
  const prod = process.env.NODE_ENV === "production";
  if (process.env.APP_ENV === "production" && process.env.SEED_SAMPLE_PRODUCTS === "1") throw new Error("Refusing to seed sample products in production.");
  const samples = !prod || process.env.SEED_SAMPLE_PRODUCTS === "1";

  for (const c of CATEGORIES) await prisma.category.upsert({ where: { slug: c.slug }, create: c, update: {} });
  const cats = new Map((await prisma.category.findMany()).map((c) => [c.slug, c.id]));
  for (const p of samples ? PRODUCTS : []) {
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const exists = await prisma.product.findUnique({ where: { sku: p.sku } });
    if (exists) continue;
    const created = await prisma.product.create({
      data: {
        sku: p.sku, slug, name: p.name, priceMinor: p.price * 100, listPriceMinor: p.price * 100, pv: p.pv, stock: p.stock, featured: !!p.featured,
        status: "ACTIVE", weightGrams: 500,
        categoryId: cats.get(p.cat), description: `${p.name}.\n\nSample product for setting up the shop. Replace the name, description, price, PV and photos with your real catalogue before launch.`,
      },
    });
    await prisma.inventoryMovement.create({ data: { productId: created.id, delta: p.stock, balance: p.stock, reason: "RESTOCK", note: "Seed stock" } });
  }
  // One sample product with options, to show how sizes work.
  if (samples && !(await prisma.product.findUnique({ where: { sku: "SAMPLE-009" } }))) {
    const withOptions = await prisma.product.create({
      data: {
        sku: "SAMPLE-009", slug: "sample-product-with-sizes", name: "Sample product with sizes", priceMinor: 600000, listPriceMinor: 600000, pv: 30,
        status: "ACTIVE", weightGrams: 300, categoryId: cats.get("personal-care"),
        description: "Sample product with two sizes. Replace it with a real product before launch, or archive it.",
        variants: {
          create: [
            { sku: "SAMPLE-009-S", name: "250 g", options: { Size: "250 g" }, stock: 20, sortOrder: 0 },
            { sku: "SAMPLE-009-L", name: "500 g", options: { Size: "500 g" }, priceMinor: 1000000, pv: 50, weightGrams: 550, stock: 10, sortOrder: 1 },
          ],
        },
      },
      include: { variants: true },
    });
    for (const v of withOptions.variants) {
      await prisma.inventoryMovement.create({ data: { productId: withOptions.id, variantId: v.id, delta: v.stock, balance: v.stock, reason: "RESTOCK", note: "Seed stock" } });
    }
  }

  if (process.env.SEED_DEMO === "1") {
    const pw = await hashPassword("Password123");
    const mk = async (name: string, e: string, role: "AFFILIATE" | "CUSTOMER", sponsorId: string) => {
      const u = await prisma.user.upsert({
        where: { email: e },
        create: { email: e, name, role, passwordHash: pw, referralCode: randomCode(8), sponsorId, emailVerifiedAt: new Date() },
        update: {},
      });
      return u;
    };
    const { placeInTree } = await import("../src/lib/tree");
    const ada = await mk("Ada Demo", "ada@demo.local", "AFFILIATE", admin.id);
    const bayo = await mk("Bayo Demo", "bayo@demo.local", "AFFILIATE", ada.id);
    const chi = await mk("Chi Demo", "chi@demo.local", "AFFILIATE", ada.id);
    await mk("Dami Customer", "dami@demo.local", "CUSTOMER", ada.id);
    await prisma.$transaction(async (tx) => {
      await placeInTree(tx, ada.id, admin!.id, "LEFT");
      await placeInTree(tx, bayo.id, ada.id, "LEFT");
      await placeInTree(tx, chi.id, ada.id, "RIGHT");
    });
    console.log("Demo members (password Password123): ada@demo.local (affiliate), bayo@demo.local, chi@demo.local, dami@demo.local (customer)");
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
