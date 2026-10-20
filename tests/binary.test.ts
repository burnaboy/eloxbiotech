import { describe, expect, it } from "vitest";
import { computePairing } from "@/lib/binary";
import { DEFAULT_COMP_PLAN, type CompPlan } from "@/lib/settings";

const plan = (p: Partial<CompPlan> = {}): CompPlan => ({ ...DEFAULT_COMP_PLAN, dailyCapMinor: 0, ...p });

describe("computePairing", () => {
  it("pairs 1:1 and carries the remainder", () => {
    const r = computePairing({ leftPv: 350, rightPv: 120, qualified: true }, plan());
    expect(r.pairs).toBe(1);
    expect(r.paidMinor).toBe(1000);
    expect(r.leftCarryPv).toBe(250);
    expect(r.rightCarryPv).toBe(20);
  });

  it("pays nothing and keeps volume when unqualified", () => {
    const r = computePairing({ leftPv: 500, rightPv: 500, qualified: false }, plan({ carryForward: false }));
    expect(r.pairs).toBe(0);
    expect(r.leftCarryPv).toBe(500);
    expect(r.rightCarryPv).toBe(500);
  });

  it("applies the cap and flushes the excess", () => {
    const r = computePairing({ leftPv: 1000, rightPv: 1000, qualified: true }, plan({ dailyCapMinor: 2500 }));
    expect(r.pairs).toBe(10);
    expect(r.grossMinor).toBe(10000);
    expect(r.paidMinor).toBe(2500);
    expect(r.flushedMinor).toBe(7500);
    expect(r.leftCarryPv).toBe(0);
  });

  it("clears leftovers when carry forward is off", () => {
    const r = computePairing({ leftPv: 350, rightPv: 120, qualified: true }, plan({ carryForward: false }));
    expect(r.leftCarryPv).toBe(0);
    expect(r.rightCarryPv).toBe(0);
  });

  it("limits carry to maxCarryPv", () => {
    const r = computePairing({ leftPv: 5000, rightPv: 100, qualified: true }, plan({ maxCarryPv: 1000 }));
    expect(r.leftCarryPv).toBe(1000);
  });

  it("2:1 finds the best number of pairs (checked against brute force)", () => {
    for (let lu = 0; lu <= 12; lu++) {
      for (let ru = 0; ru <= 12; ru++) {
        let best = 0;
        for (let x = 0; x <= 12; x++) for (let y = 0; y <= 12; y++) if (2 * x + y <= lu && x + 2 * y <= ru) best = Math.max(best, x + y);
        const r = computePairing({ leftPv: lu * 100, rightPv: ru * 100, qualified: true }, plan({ pairingRatio: "2:1" }));
        expect(r.pairs, `lu=${lu} ru=${ru}`).toBe(best);
        expect(r.leftUsedPv).toBeLessThanOrEqual(lu * 100);
        expect(r.rightUsedPv).toBeLessThanOrEqual(ru * 100);
        expect(r.leftUsedPv + r.rightUsedPv).toBe(best * 300);
      }
    }
  });
});
