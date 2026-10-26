import { describe, expect, it } from "vitest";
import { RANKS, rankProgress } from "@/lib/ranks";

describe("rankProgress", () => {
  it("starts everyone at the first rank", () => {
    const p = rankProgress({ directs: 0, lesserLegPv: 0 });
    expect(p.current.name).toBe("Member");
    expect(p.next?.name).toBe("Bronze");
    expect(p.directsPct).toBe(0);
  });

  it("needs every requirement of a rank", () => {
    expect(rankProgress({ directs: 10, lesserLegPv: 99 }).current.name).toBe("Member");
    expect(rankProgress({ directs: 2, lesserLegPv: 100 }).current.name).toBe("Bronze");
  });

  it("stops at the first rank not met, even if a higher one's PV is reached", () => {
    const p = rankProgress({ directs: 4, lesserLegPv: 60_000 });
    expect(p.current.name).toBe("Silver");
    expect(p.pvPct).toBe(100);
    expect(p.directsPct).toBe(66);
    expect(p.achieved.map((r) => r.name)).toEqual(["Member", "Bronze", "Silver"]);
  });

  it("has no next rank at the top", () => {
    const top = RANKS[RANKS.length - 1];
    const p = rankProgress({ directs: top.directs, lesserLegPv: top.lesserLegPv });
    expect(p.current.name).toBe(top.name);
    expect(p.next).toBeNull();
  });
});
