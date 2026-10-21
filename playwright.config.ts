import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
export const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://mlm:mlm@localhost:5432/mlm_e2e?schema=public";
const env = {
  DATABASE_URL: E2E_DB,
  APP_URL: `http://localhost:${PORT}`,
  PAYMENT_PROVIDER: "test",
  ALLOW_TEST_PAYMENTS: "true",
  TEST_PAYMENT_SECRET: "e2e-secret",
  CRON_SECRET: "e2e-cron",
  MONITOR_TOKEN: "e2e-monitor",
  STORAGE_DRIVER: "local",
  ALLOW_LOCAL_STORAGE: "true",
  UPLOAD_DIR: ".data/e2e-uploads",
  APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY ?? "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
};
Object.assign(process.env, env);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /storefront/ },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    env,
    timeout: 120_000,
  },
});
