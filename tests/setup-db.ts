import { execSync } from "node:child_process";

process.env.DATABASE_URL = "postgresql://mlm:mlm@localhost:5432/mlm_test?schema=public";
process.env.TEST_PAYMENT_SECRET = "test-secret";
process.env.PAYMENT_PROVIDER = "test";
process.env.CURRENCY = "USD";

export default function globalSetup() {
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
}
