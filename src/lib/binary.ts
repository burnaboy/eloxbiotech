import type { CompPlan } from "./settings";

export interface PairInput {
  leftPv: number;
  rightPv: number;
  qualified: boolean;
  /** Binary already earned this period (for the cap). */
  earnedThisPeriodMinor?: number;
}

export interface PairResult {
  pairs: number;
  leftUsedPv: number;
  rightUsedPv: number;
  grossMinor: number;
  paidMinor: number;
  flushedMinor: number;
  leftCarryPv: number;
  rightCarryPv: number;
}

/**
 * Pure pairing maths for one affiliate in one period. No I/O, so it is easy to test.
 * - 1:1: one unit left + one unit right.
 * - 2:1: two units on either side with one on the other, choosing the mix that pays the most pairs.
 * Cap overflow is flushed (volume consumed, not paid). Unqualified affiliates keep their volume.
 */
export function computePairing(input: PairInput, plan: CompPlan): PairResult {
  const { pairUnitPv: unit } = plan;
  let left = Math.max(0, input.leftPv);
  let right = Math.max(0, input.rightPv);
  const empty = { pairs: 0, leftUsedPv: 0, rightUsedPv: 0, grossMinor: 0, paidMinor: 0, flushedMinor: 0 };

  if (!input.qualified) {
    return { ...empty, ...carry(left, right, plan, false) };
  }

  const lu = Math.floor(left / unit);
  const ru = Math.floor(right / unit);
  let leftUnits = 0;
  let rightUnits = 0;
  let pairs = 0;

  if (plan.pairingRatio === "1:1") {
    pairs = Math.min(lu, ru);
    leftUnits = rightUnits = pairs;
  } else {
    // Maximise x + y subject to 2x + y <= lu, x + 2y <= ru (x = left-heavy pairs, y = right-heavy).
    pairs = Math.min(Math.floor((lu + ru) / 3), lu, ru);
    // Find a split of left-heavy (x) and right-heavy (y) pairs that fits both legs.
    let x = 0;
    while (x <= pairs && !(2 * x + (pairs - x) <= lu && x + 2 * (pairs - x) <= ru)) x++;
    const y = pairs - x;
    leftUnits = 2 * x + y;
    rightUnits = x + 2 * y;
  }

  const leftUsedPv = leftUnits * unit;
  const rightUsedPv = rightUnits * unit;
  left -= leftUsedPv;
  right -= rightUsedPv;

  const grossMinor = pairs * plan.pairValueMinor;
  let paidMinor = grossMinor;
  if (plan.dailyCapMinor > 0) {
    const room = Math.max(0, plan.dailyCapMinor - (input.earnedThisPeriodMinor ?? 0));
    paidMinor = Math.min(grossMinor, room);
  }
  return {
    pairs,
    leftUsedPv,
    rightUsedPv,
    grossMinor,
    paidMinor,
    flushedMinor: grossMinor - paidMinor,
    ...carry(left, right, plan, true),
  };
}

function carry(left: number, right: number, plan: CompPlan, ranPairing: boolean) {
  if (ranPairing && !plan.carryForward) return { leftCarryPv: 0, rightCarryPv: 0 };
  const cap = plan.maxCarryPv > 0 ? plan.maxCarryPv : Infinity;
  return { leftCarryPv: Math.min(left, cap), rightCarryPv: Math.min(right, cap) };
}
