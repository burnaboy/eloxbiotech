import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { affiliate, buyAndPay, later, makeRoot, node, product, resetDb, setPlan } from "./helpers";
import { isQualified, matureOrders, qualifiedSet, runBinary } from "@/lib/commissions";
import { getCompPlan } from "@/lib/settings";
import { deliverPendingEmails, queueEmail } from "@/lib/email";

beforeEach(async () => {
  await resetDb();
});

/** A small random-shaped network: each new member picks an earlier member as sponsor and a random side. */
async function network(size: number, seed = 7) {
  let x = seed;
  const rand = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const root = await makeRoot();
  const members = [root];
  for (let i = 0; i < size; i++) {
    const sponsor = members[Math.floor(rand() * members.length)];
    members.push(await affiliate(sponsor.referralCode, rand() < 0.5 ? "LEFT" : "RIGHT"));
  }
  return members;
}

describe("scaling", () => {
  it("batch qualification gives the same answer as the one-node check for every member", async () => {
    await setPlan({ requireDirectOnEachLeg: true, minPersonalPv: 0 });
    await network(40);
    // Make some members inactive so status matters too.
    const some = await prisma.user.findMany({ where: { role: "AFFILIATE" }, take: 5, orderBy: { createdAt: "desc" } });
    await prisma.user.updateMany({ where: { id: { in: some.map((u) => u.id) } }, data: { status: "SUSPENDED" } });
    const plan = await getCompPlan();
    const nodes = await prisma.affiliateNode.findMany();
    const batch = await qualifiedSet(prisma, nodes.map((n) => n.id), plan);
    let qualifiedCount = 0;
    for (const n of nodes) {
      const one = await isQualified(prisma, n, plan);
      if (one) qualifiedCount++;
      expect(batch.has(n.id), `node ${n.id}`).toBe(one);
    }
    expect(qualifiedCount).toBeGreaterThan(0); // the test means something
  });

  it("a binary run in small batches pays the same as one big batch, and resumes after stopping part-way", async () => {
    const setup = async () => {
      await resetDb();
      await setPlan({ holdDays: 0, pairUnitPv: 100, pairValueMinor: 1000, requireDirectOnEachLeg: false, binaryEnabled: true, binaryRetailOnly: false });
      const members = await network(25, 11);
      const p = await product({ pv: 100, stock: 1000 });
      for (const [i, m] of members.slice(1).entries()) await buyAndPay(m.id, p.id, 1 + (i % 3));
      await matureOrders(later(1));
      members.forEach((m, i) => index.set(m.id, i));
      return members;
    };
    const index = new Map<string, number>();
    const summary = async () => {
      const rows = await prisma.commission.findMany({ where: { type: "BINARY" } });
      const carry = await prisma.affiliateNode.findMany();
      return {
        paid: Object.fromEntries(rows.map((c) => [index.get(c.userId), c.amountMinor])),
        carry: Object.fromEntries(carry.map((n) => [index.get(n.userId), [n.leftCarryPv, n.rightCarryPv]])),
      };
    };

    await setup();
    const big = await runBinary("p1", null, { batchSize: 10_000 });
    const expected = await summary();
    expect(big.amountMinor).toBeGreaterThan(0);

    await setup();
    const small = await runBinary("p1", null, { batchSize: 3 });
    expect(await summary()).toEqual(expected);
    expect(small.amountMinor).toBe(big.amountMinor);
    expect(small.pairsPaid).toBe(big.pairsPaid);

    // Simulate a run that stopped part-way: it exists but isn't marked complete. Running again finishes it without paying twice.
    await setup();
    const stopped = await runBinary("p1", null, { batchSize: 2, maxBatches: 2 });
    expect(stopped.completedAt).toBeNull();
    expect(await prisma.carryMovement.count({ where: { runId: stopped.id } })).toBeGreaterThan(0);
    await runBinary("p1", null, { batchSize: 2 });
    await expect(runBinary("p1", null)).rejects.toThrow(/already been run/);
    expect(await summary()).toEqual(expected);
    expect((await prisma.binaryRun.findUniqueOrThrow({ where: { id: stopped.id } })).completedAt).not.toBeNull();
  });

  it("overlapping binary calls for the same period never pay a node twice", async () => {
    await setPlan({ holdDays: 0, pairUnitPv: 100, pairValueMinor: 1000, requireDirectOnEachLeg: false, binaryEnabled: true, binaryRetailOnly: false });
    const members = await network(20, 3);
    const p = await product({ pv: 100, stock: 1000 });
    for (const m of members.slice(1)) await buyAndPay(m.id, p.id, 2);
    await matureOrders(later(1));
    const results = await Promise.allSettled([runBinary("p1", null, { batchSize: 2 }), runBinary("p1", null, { batchSize: 2 }), runBinary("p1", null, { batchSize: 2 })]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    const dupes = await prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM (SELECT "userId" FROM "Commission" WHERE type = 'BINARY' GROUP BY "userId" HAVING COUNT(*) > 1) d`;
    expect(dupes[0].n).toBe(0);
    for (const m of members) {
      const n = await node(m.id);
      expect(n.leftCarryPv).toBeGreaterThanOrEqual(0);
    }
  });

  it("maturing reads only orders past the shortest hold period, page by page", async () => {
    await setPlan({ holdDays: 3 });
    const members = await network(3);
    const p = await product({ pv: 10, stock: 1000 });
    for (const m of members.slice(1)) await buyAndPay(m.id, p.id);
    expect(await matureOrders(later(1))).toBe(0);
    await setPlan({ holdDays: 7 }); // older orders keep their own 3-day hold
    expect(await matureOrders(later(4))).toBe(3);
    expect(await matureOrders(later(4))).toBe(0);
  });

  it("sends a large email queue in one run, each email once", async () => {
    for (let i = 0; i < 250; i++) await queueEmail(`m${i}@example.com`, "Hello", "Body");
    const sent = await Promise.all([deliverPendingEmails(), deliverPendingEmails()]);
    expect(sent[0] + sent[1]).toBe(250);
    expect(await prisma.emailOutbox.count({ where: { sentAt: null } })).toBe(0);
  });
});

describe("database pool settings", () => {
  it("adds the pool size and timeout to the database URL unless it already has them", async () => {
    const { databaseUrl } = await import("@/lib/db");
    const base = "postgresql://u:p@db:5432/app?sslmode=require";
    expect(databaseUrl({ DATABASE_URL: base })).toBe(base);
    const set = new URL(databaseUrl({ DATABASE_URL: base, DB_POOL_SIZE: "10", DB_POOL_TIMEOUT: "20" })!);
    expect(set.searchParams.get("connection_limit")).toBe("10");
    expect(set.searchParams.get("pool_timeout")).toBe("20");
    expect(set.searchParams.get("sslmode")).toBe("require");
    const kept = new URL(databaseUrl({ DATABASE_URL: `${base}&connection_limit=3`, DB_POOL_SIZE: "10" })!);
    expect(kept.searchParams.get("connection_limit")).toBe("3");
    expect(databaseUrl({ DATABASE_URL: base, DB_POOL_SIZE: "abc" })).toBe(base);
  });
});
