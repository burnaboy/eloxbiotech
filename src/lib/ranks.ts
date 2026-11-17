/*
 * Rank awards shown on the member dashboard.
 *
 * A member's rank is worked out live from figures the app already keeps, so nothing is stored or posted:
 *   directs       personally referred affiliates who are active
 *   lesserLegPv   lifetime PV of the member's weaker binary leg (min of left and right total PV)
 *
 * Awards are recognition handed out by staff. Reaching a rank does not move money or change commissions.
 * The thresholds and awards below are starting defaults; change them here to match the official plan.
 */

export interface Rank {
  name: string;
  directs: number;
  lesserLegPv: number;
  award: string;
}

export const RANKS: Rank[] = [
  { name: "Member", directs: 0, lesserLegPv: 0, award: "Welcome pack" },
  { name: "Bronze", directs: 2, lesserLegPv: 100, award: "Certificate of achievement" },
  { name: "Silver", directs: 4, lesserLegPv: 500, award: "Elox product hamper" },
  { name: "Gold", directs: 6, lesserLegPv: 2_000, award: "Smartphone" },
  { name: "Platinum", directs: 10, lesserLegPv: 10_000, award: "Laptop" },
  { name: "Diamond", directs: 15, lesserLegPv: 50_000, award: "Local holiday trip" },
  { name: "Crown", directs: 25, lesserLegPv: 200_000, award: "Car award" },
];

export interface RankProgress {
  current: Rank;
  next: Rank | null;
  /** 0 to 100 for each requirement of the next rank. */
  directsPct: number;
  pvPct: number;
  achieved: Rank[];
}

/** Pure: the highest rank whose every requirement is met, and progress toward the next one. */
export function rankProgress(stats: { directs: number; lesserLegPv: number }, ranks: Rank[] = RANKS): RankProgress {
  const meets = (r: Rank) => stats.directs >= r.directs && stats.lesserLegPv >= r.lesserLegPv;
  let i = 0;
  while (i + 1 < ranks.length && meets(ranks[i + 1])) i++;
  const next = ranks[i + 1] ?? null;
  const pct = (have: number, need: number) => (need <= 0 ? 100 : Math.min(100, Math.floor((have / need) * 100)));
  return {
    current: ranks[i],
    next,
    directsPct: next ? pct(stats.directs, next.directs) : 100,
    pvPct: next ? pct(stats.lesserLegPv, next.lesserLegPv) : 100,
    achieved: ranks.slice(0, i + 1),
  };
}
