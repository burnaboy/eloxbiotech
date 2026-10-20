import { execSync } from "node:child_process";

export default async function globalSetup() {
  const env = { ...process.env };
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const tables: { tablename: string }[] = await prisma.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`);
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await prisma.$disconnect();
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env: { ...env, SEED_ADMIN_PASSWORD: "AdminPass123", SEED_DEMO: "1" } });
}
