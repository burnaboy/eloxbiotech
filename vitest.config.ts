import { defineConfig } from "vitest/config";
import path from "node:path";

const env = {
  DATABASE_URL: "postgresql://mlm:mlm@localhost:5432/mlm_test?schema=public",
  TEST_PAYMENT_SECRET: "test-secret",
  PAYMENT_PROVIDER: "test",
  CURRENCY: "NGN",
  // Test-only key for encrypting bank account numbers in the test database.
  APP_ENCRYPTION_KEY: "dGVzdC1vbmx5LWtleS0zMi1ieXRlcy1sb25nLSEhISE=",
  PAYOUT_VERIFICATION: "test",
};

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Server-only modules are marked with `import "server-only"` so Next refuses to bundle them for the
      // browser. Tests run in plain Node, so the marker resolves to an empty module here.
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
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
