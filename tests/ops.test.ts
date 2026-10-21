import { describe, expect, it } from "vitest";
import { paystackSecretKey } from "@/lib/payments/keys";
import { problems } from "../scripts/check-migrations";
// @ts-expect-error plain JavaScript module without type declarations
import { dueJobs } from "../scripts/run-scheduled.mjs";

describe("go-live safeguards", () => {
  it("accepts a live Paystack key only in production, outside staging, after explicit approval", () => {
    const live = "sk_live_abc", test = "sk_test_abc";
    expect(paystackSecretKey({ NODE_ENV: "development", PAYSTACK_SECRET_KEY: test } as NodeJS.ProcessEnv)).toBe(test);
    expect(paystackSecretKey({ NODE_ENV: "production", APP_ENV: "staging", PAYSTACK_SECRET_KEY: test } as NodeJS.ProcessEnv)).toBe(test);
    expect(() => paystackSecretKey({ NODE_ENV: "development", PAYSTACK_SECRET_KEY: live, LIVE_PAYMENTS_APPROVED: "true" } as NodeJS.ProcessEnv)).toThrow(/test key/);
    expect(() => paystackSecretKey({ NODE_ENV: "production", APP_ENV: "staging", PAYSTACK_SECRET_KEY: live, LIVE_PAYMENTS_APPROVED: "true" } as NodeJS.ProcessEnv)).toThrow(/test key/);
    expect(() => paystackSecretKey({ NODE_ENV: "production", PAYSTACK_SECRET_KEY: live } as NodeJS.ProcessEnv)).toThrow(/approved/);
    expect(paystackSecretKey({ NODE_ENV: "production", PAYSTACK_SECRET_KEY: live, LIVE_PAYMENTS_APPROVED: "true" } as NodeJS.ProcessEnv)).toBe(live);
    expect(() => paystackSecretKey({ NODE_ENV: "production", PAYSTACK_SECRET_KEY: "pk_live_abc" } as NodeJS.ProcessEnv)).toThrow(/doesn't look/);
    expect(() => paystackSecretKey({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/not set/);
  });

  it("blocks destructive migrations unless approved in writing", () => {
    expect(problems(`CREATE TABLE "X" ("id" TEXT);\nCREATE INDEX "x_i" ON "X"("id");`)).toEqual([]);
    expect(problems(`ALTER TABLE "Order" ADD COLUMN "note" TEXT;`)).toEqual([]);
    for (const sql of [`DROP TABLE "Order";`, `ALTER TABLE "User" DROP COLUMN "name";`, `TRUNCATE "Payment";`, `DELETE FROM "Commission";`, `UPDATE "User" SET "role" = 'X';`, `ALTER TABLE "A" RENAME COLUMN "b" TO "c";`, `ALTER TABLE "A" ALTER COLUMN "b" TYPE INTEGER;`]) {
      expect(problems(sql).length, sql).toBeGreaterThan(0);
    }
    expect(problems(`-- DROP TABLE "Order"; (just a comment)\nSELECT 1;`)).toEqual([]);
    expect(problems(`-- approved-destructive: Dee, 2026-11-01, old column unused since v1.2\nALTER TABLE "User" DROP COLUMN "legacy";`)).toEqual([]);
  });
});

describe("scheduler", () => {
  it("runs each job at its interval over a whole day, daily jobs once at their Lagos time", () => {
    const counts: Record<string, number> = {};
    const at: Record<string, string> = {};
    const start = Date.parse("2026-10-20T23:00:00Z"); // midnight in Lagos
    for (let m = 0; m < 1440; m++) {
      const d = new Date(start + m * 60e3 + 20e3);
      for (const j of dueJobs(d) as string[]) {
        counts[j] = (counts[j] ?? 0) + 1;
        at[j] = d.toISOString();
      }
    }
    expect(counts).toEqual({
      "send-emails": 1440, "expire-orders": 288, "reconcile-payments": 144, "seal-audit": 144,
      "mature-orders": 24, "refresh-prices": 24, binary: 1, "reconcile-ledger": 1, "reconcile-volume": 1, cleanup: 1, "reconcile-gateway": 1,
    });
    expect(at.binary).toBe("2026-10-20T23:15:20.000Z"); // 00:15 in Lagos
  });
});
