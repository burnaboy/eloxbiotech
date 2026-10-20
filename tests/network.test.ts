import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { affiliate, buyAndPay, customer, later, makeRoot, node, product, resetDb, setPlan } from "./helpers";
import { placeInTree } from "@/lib/tree";
import { matureOrders, runBinary } from "@/lib/commissions";
import { refundOrder } from "@/lib/refunds";
import { reconcileVolume, volumeSummary } from "@/lib/volume";
import { becomeAffiliate } from "@/lib/users";

beforeEach(async () => {
  await resetDb();
  await setPlan({});
});

describe("placement rules", () => {
  it("records who placed each member and how", async () => {
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const b = await affiliate(a.referralCode);
    const ra = await prisma.placementRecord.findFirstOrThrow({ where: { userId: a.id } });
    expect(ra.method).toBe("SPONSOR_CHOICE");
    expect(ra.sponsorId).toBe(root.id);
    expect(ra.position).toBe("LEFT");
    const rb = await prisma.placementRecord.findFirstOrThrow({ where: { userId: b.id } });
    expect(rb.method).toBe("AUTO");
  });

  it("rejects self-sponsorship", async () => {
    const root = await makeRoot();
    const a = await affiliate(root.referralCode);
    await expect(prisma.$transaction((tx) => placeInTree(tx, a.id, a.id))).rejects.toThrow(/sponsor themselves/);
    await expect(prisma.user.update({ where: { id: a.id }, data: { sponsorId: a.id } })).rejects.toThrow();
  });

  it("makes placements and sponsors permanent at the database level", async () => {
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    const b = await affiliate(root.referralCode, "RIGHT");
    const na = await node(a.id);
    await expect(prisma.affiliateNode.update({ where: { id: na.id }, data: { position: "RIGHT" } })).rejects.toThrow();
    await expect(prisma.affiliateNode.update({ where: { id: na.id }, data: { parentId: (await node(b.id)).id } })).rejects.toThrow();
    await expect(prisma.user.update({ where: { id: a.id }, data: { sponsorId: b.id } })).rejects.toThrow();
    await expect(prisma.placementRecord.updateMany({ where: { userId: a.id }, data: { note: "edited" } })).rejects.toThrow();
    await expect(prisma.placementRecord.deleteMany({ where: { userId: a.id } })).rejects.toThrow();
  });

  it("queues new affiliates for an admin when approval placement is on", async () => {
    await setPlan({ placementMode: "ADMIN_APPROVAL" });
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "RIGHT");
    expect(await prisma.affiliateNode.findUnique({ where: { userId: a.id } })).toBeNull();
    const u = await prisma.user.findUniqueOrThrow({ where: { id: a.id } });
    expect(u.placementPending).toBe(true);
    expect(u.requestedLeg).toBe("RIGHT");

    const rootNode = await node(root.id);
    await prisma.$transaction((tx) => placeInTree(tx, a.id, root.id, "LEFT", { method: "ADMIN", actorId: root.id, parentNodeId: rootNode.id }));
    const placed = await node(a.id);
    expect(placed.position).toBe("LEFT");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.id } })).placementPending).toBe(false);
    const rec = await prisma.placementRecord.findFirstOrThrow({ where: { userId: a.id } });
    expect(rec.method).toBe("ADMIN");
    expect(rec.actorId).toBe(root.id);
    expect((await node(root.id)).leftCount).toBe(1);
  });

  it("blocks admin placement into a taken slot, outside the sponsor's downline, or twice", async () => {
    await setPlan({ placementMode: "ADMIN_APPROVAL" });
    const root = await makeRoot();
    await setPlan({ placementMode: "AUTO" });
    const x = await affiliate(root.referralCode, "LEFT");
    const y = await affiliate(root.referralCode, "RIGHT");
    await setPlan({ placementMode: "ADMIN_APPROVAL" });
    const p = await affiliate(x.referralCode); // sponsored by x, pending
    const rootNode = await node(root.id);
    const place = (parentNodeId: string, leg: "LEFT" | "RIGHT") =>
      prisma.$transaction((tx) => placeInTree(tx, p.id, x.id, leg, { method: "ADMIN", actorId: root.id, parentNodeId }));
    await expect(place(rootNode.id, "LEFT")).rejects.toThrow(/sponsor's own downline/);
    await expect(place((await node(y.id)).id, "LEFT")).rejects.toThrow(/sponsor's own downline/);
    await place((await node(x.id)).id, "RIGHT");
    await expect(place((await node(x.id)).id, "LEFT")).rejects.toThrow(/already has a position/);
    const q = await affiliate(x.referralCode);
    const xNode = await node(x.id);
    await expect(
      prisma.$transaction((tx) => placeInTree(tx, q.id, x.id, "RIGHT", { method: "ADMIN", actorId: root.id, parentNodeId: xNode.id })),
    ).rejects.toThrow(/already filled/);
  });

  it("pays nothing for registering, recruiting or filling a position", async () => {
    await setPlan({ binaryEnabled: true });
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    await affiliate(a.referralCode, "LEFT");
    await affiliate(a.referralCode, "RIGHT");
    const c = await customer(a.referralCode);
    await becomeAffiliate(c.id, "LEFT");
    await matureOrders(later(30));
    await runBinary("2026-01-01", null);
    expect(await prisma.commission.count()).toBe(0);
    expect(await prisma.volumeEntry.count()).toBe(0);
    const na = await node(a.id);
    expect(na.leftCarryPv + na.rightCarryPv + na.personalPv).toBe(0);
  });
});

describe("volume ledger", () => {
  it("separates pending, credited, refunded and qualifying volume and reconciles cleanly", async () => {
    await setPlan({ holdDays: 7, pairUnitPv: 100, pairValueMinor: 1000, requireDirectOnEachLeg: false, binaryEnabled: true, binaryRetailOnly: false });
    const root = await makeRoot();
    const l = await affiliate(root.referralCode, "LEFT");
    const r = await affiliate(root.referralCode, "RIGHT");
    const p = await product({ priceMinor: 5000, pv: 100, stock: 50 });
    const o1 = await buyAndPay(l.id, p.id, 3); // 300 PV left
    await buyAndPay(r.id, p.id, 1); // 100 PV right

    let v = await volumeSummary(await node(root.id));
    expect(v.left.pendingPv).toBe(300);
    expect(v.right.pendingPv).toBe(100);
    expect(v.left.creditedPv).toBe(0);

    await matureOrders(later(8));
    v = await volumeSummary(await node(root.id));
    expect(v.left).toMatchObject({ creditedPv: 300, reversedPv: 0, netPv: 300, qualifyingPv: 300, pendingPv: 0, periodPv: 300 });

    await runBinary("2026-01-01", null); // pairs 100/100: left carry 200, right 0
    v = await volumeSummary(await node(root.id));
    expect(v.left.qualifyingPv).toBe(200);
    expect(v.left.periodPv).toBe(0); // new period started
    expect(v.left.netPv).toBe(300);

    // Refund the 300 PV order: only 200 is left in carry, so carry floors at zero.
    await refundOrder(o1.id, root.id, { reason: "test" });
    const n = await node(root.id);
    expect(n.leftCarryPv).toBe(0);
    v = await volumeSummary(n);
    expect(v.left).toMatchObject({ creditedPv: 300, reversedPv: 300, netPv: 0, qualifyingPv: 0 });
    expect((await volumeSummary(await node(l.id))).personal.reversedPv).toBe(300);

    const rec = await reconcileVolume(null);
    expect(rec.issues).toEqual([]);
  });

  it("flags totals that drift from the sales ledger", async () => {
    const root = await makeRoot();
    const a = await affiliate(root.referralCode, "LEFT");
    await prisma.affiliateNode.update({ where: { userId: root.id }, data: { leftCarryPv: 999 } });
    await prisma.affiliateNode.update({ where: { userId: a.id }, data: { rightCount: 4 } });
    const rec = await reconcileVolume(null);
    expect(rec.issueCount).toBe(2);
    expect(rec.issues.map((i) => i.detail).join("\n")).toMatch(/left carry PV: stored 999/);
    expect(await prisma.auditLog.count({ where: { action: "volume.reconcile" } })).toBe(1);
  });
});
