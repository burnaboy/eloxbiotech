import { defineConfig } from "vitest/config";
import path from "node:path";

const env = {
  DATABASE_URL: "postgresql://mlm:mlm@localhost:5432/mlm_test?schema=public",
  TEST_PAYMENT_SECRET: "test-secret",
  PAYMENT_PROVIDER: "test",
  CURRENCY: "NGN",
};

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    env,
    globalSetup: ["tests/setup-db.ts"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    include: ["tests/**/*.test.ts"],
  },
});
