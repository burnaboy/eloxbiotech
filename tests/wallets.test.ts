import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { affiliate, buyAndPay, customer, later, makeRoot, product, resetDb, setPlan } from "./helpers";
import { matureOrders } from "@/lib/commissions";
import { adjustWallet, walletBalance } from "@/lib/wallet";
import { splitWallets, subWallets } from "@/lib/wallets";

describe("Unilevel and Bonus wallets", () => {
  it("puts direct commissions in Unilevel and binary and adjustments in Bonus", () => {
    const w = splitWallets([
      { type: "DIRECT", pending: 100, held: 0, available: 500 },
      { type: "BINARY", pending: 0, held: 50, available: 700 },
      { type: "ADJUSTMENT", pending: 0, held: 0, available: -200 },
    ]);
    expect(w.unilevel).toEqual({ earnedMinor: 500, pendingMinor: 100, heldMinor: 0 });
    expect(w.bonus).toEqual({ earnedMinor: 500, pendingMinor: 0, heldMinor: 50 });
  });

  describe("from the ledger", () => {
    beforeEach(async () => {
      await resetDb();
      await setPlan({ holdDays: 0, directRateBps: 1000 });
    });

    it("follows a direct commission from pending to earned, and ignores corrections", async () => {
      const root = await makeRoot();
      const a = await affiliate(root.referralCode, "LEFT");
      const c = await customer(a.referralCode);
      const p = await product();
      await buyAndPay(c.id, p.id);
      const commission = await prisma.commission.findFirstOrThrow({ where: { userId: a.id, type: "DIRECT" } });
      expect((await subWallets(a.id)).unilevel).toEqual({ earnedMinor: 0, pendingMinor: commission.amountMinor, heldMinor: 0 });

      await matureOrders(later(1));
      await adjustWallet(a.id, { amountMinor: 2500, reason: "Goodwill credit for late delivery" }, root.id);
      const w = await subWallets(a.id);
      expect(w.unilevel).toEqual({ earnedMinor: commission.amountMinor, pendingMinor: 0, heldMinor: 0 });
      expect(w.bonus).toEqual({ earnedMinor: 0, pendingMinor: 0, heldMinor: 0 });
      expect((await walletBalance(a.id)).availableMinor).toBe(commission.amountMinor + 2500);
    });
  });
});
