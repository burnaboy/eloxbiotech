import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { affiliate, buyAndPay, customer, makeRoot, product, resetDb, setPlan, bankAccount } from "./helpers";
import { csvCell, toCsv } from "@/lib/csv";
import { parseRange, dateWhere } from "@/lib/admin-filters";
import { attributionReport, payoutReconciliation, revenueReport } from "@/lib/reports";
import { buildExport } from "@/lib/exports";
import { adjustWallet, createPayoutBatch, requestPayout, reviewPayout, settlePayout } from "@/lib/wallet";
import { recordJob, jobStatus, systemHealth } from "@/lib/health";
import { refundOrder } from "@/lib/refunds";

beforeEach(async () => {
  await resetDb();
  await setPlan({});
});

describe("CSV export", () => {
  it("neutralises spreadsheet formulas and quotes awkward text", () => {
    for (const bad of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd", "＝1+1"]) {
      const out = csvCell(bad);
      expect(out.replace(/^"/, "").startsWith("'")).toBe(true);
    }
    expect(csvCell(-1500)).toBe("-1500"); // real numbers stay numbers
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe("");
    const csv = toCsv(["a", "b"], [["=1", 2]]);
    expect(csv).toBe("\uFEFFa,b\r\n\"'=1\",2\r\n");
    expect(toCsv(["a"], [], { bom: false })).toBe("a\r\n");
  });

  it("protects a member-controlled name in exports and audits each download", async () => {
    const root = await makeRoot();
    await prisma.user.update({ where: { id: root.id }, data: { name: "=cmd|' /C calc'!A0" } });
    const out = await buildExport("members", new URLSearchParams(), root.id);
    expect(out!.csv).toContain("\"'=cmd|' /C calc'!A0\"");
    expect(out!.csv).not.toMatch(/(^|,)=cmd/m);
    const log = await prisma.auditLog.findFirst({ where: { action: "export.csv" } });
    expect(log?.entityId).toBe("members");
    expect(await buildExport("nope", new URLSearchParams(), root.id)).toBeNull();
  });
});

describe("date filters", () => {
  it("uses whole Lagos days, inclusive of the end date, and ignores bad input", () => {
    const r = parseRange("2026-10-01", "2026-10-01");
    expect(r.gte!.toISOString()).toBe("2026-09-30T23:00:00.000Z");
    expect(r.lt!.toISOString()).toBe("2026-10-01T23:00:00.000Z");
    expect(parseRange("2026-10-05", "2026-10-01")).toEqual({});
    expect(dateWhere(parseRange("'; DROP TABLE x", "nope"))).toBeUndefined();
    const d = parseRange(undefined, undefined, 30);
    expect(d.from && d.to).toBeTruthy();
  });
});

describe("reports", () => {
  it("revenue, attribution and payout reconciliation add up", async () => {
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const c = await customer(a.referralCode);
    const plain = await customer();
    const p = await product({ priceMinor: 200000, stock: 20 });
    const o1 = await buyAndPay(c.id, p.id);
    await buyAndPay(plain.id, p.id);
    const b = await affiliate(a.referralCode, "LEFT");
    await buyAndPay(b.id, p.id); // an affiliate a sponsored: not retail
    await refundOrder(o1.id, root.id, { reason: "Customer changed their mind" });

    const range = parseRange(undefined, undefined, 1);
    const rev = await revenueReport(range);
    expect(rev.totals.orders).toBe(3);
    expect(rev.totals.goodsMinor).toBe(600000);
    expect(rev.totals.netMinor).toBe(rev.totals.totalMinor - rev.totals.refundedMinor);
    expect(rev.totals.refundedMinor).toBeGreaterThanOrEqual(200000);

    const att = await attributionReport(range);
    const row = att.rows.find((r) => r.referrerId === a.id)!;
    expect(row.orders).toBe(1);
    expect(row.memberPurchases).toBe(1);
    expect(row.refundedMinor).toBe(200000);
    expect(row.commissionMinor).toBe(0); // reversed by the refund

    await adjustWallet(a.id, { amountMinor: 1_000_000, reason: "Opening balance for the test" }, root.id);
    await bankAccount(a.id);
    const pay = await requestPayout(a.id, { amountMinor: 600000 });
    await reviewPayout(pay.id, "APPROVE", root.id);
    await createPayoutBatch([pay.id], root.id);
    await settlePayout(pay.id, root.id, { reference: "NIP-REPORT-1", settledAt: new Date(), evidence: "Statement line checked by finance" });
    const rec = await payoutReconciliation(parseRange(undefined, undefined, 1));
    expect(rec.problems).toEqual([]);
    expect(rec.settled.amountMinor).toBe(600000);
    expect(rec.ledgerPaid.amountMinor).toBe(600000);
    expect(rec.batches[0].paid).toBe(1);
  });
});

describe("system health", () => {
  it("tracks scheduled jobs and never reveals secrets", async () => {
    await recordJob("seal-audit", { okAt: new Date().toISOString() });
    await recordJob("send-emails", { failedAt: new Date().toISOString(), error: "SMTP refused" });
    await recordJob("not-a-job", { okAt: new Date().toISOString() });
    const jobs = await jobStatus();
    expect(jobs.find((j) => j.job === "seal-audit")!.level).toBe("ok");
    expect(jobs.find((j) => j.job === "send-emails")!.level).toBe("fail");
    expect(jobs.find((j) => j.job === "binary")!.level).toBe("warn");
    expect(jobs.some((j) => j.job === "not-a-job")).toBe(false);
    process.env.PAYSTACK_SECRET_KEY = "sk_test_secretvalue123";
    const h = await systemHealth();
    expect(JSON.stringify(h)).not.toContain("secretvalue");
    expect(JSON.stringify(h)).not.toContain(process.env.APP_ENCRYPTION_KEY!);
    delete process.env.PAYSTACK_SECRET_KEY;
  });
});

describe("security helpers", () => {
  it("rate limits per key, and parallel requests can't slip past the count", async () => {
    const { rateLimit, LIMITS } = await import("@/lib/rate-limit");
    const max = LIMITS.payoutRequest.max;
    const results = await Promise.allSettled(Array.from({ length: max + 3 }, () => rateLimit("payoutRequest", "user-1")));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(max);
    await expect(rateLimit("payoutRequest", "user-1")).rejects.toThrow(/Too many/);
    await expect(rateLimit("payoutRequest", "user-2")).resolves.toBeUndefined();
  });

  it("scrubs secrets and personal data from logged errors", async () => {
    const { scrub } = await import("@/lib/log");
    const out = scrub('Invalid update { passwordHash: "$argon2id$v=19$m=1$abc$def", email: "ada@example.com" } key sk_live_abc123 Bearer eyJabc.def account 0123456789');
    for (const leak of ["$argon2id", "ada@example.com", "sk_live_abc123", "eyJabc", "0123456789"]) expect(out).not.toContain(leak);
  });
});
