import type { CommissionType } from "@prisma/client";
import { prisma, type Tx } from "./db";

/*
 * The Unilevel and Bonus wallets shown on the member dashboard.
 *
 * These are views of the one ledger (ledger.ts), split by the kind of commission the money came from:
 *   Unilevel wallet   DIRECT commissions (earned on sales made through the member's own referral links)
 *   Bonus wallet      BINARY commissions (pairing bonus from the left and right teams) and ADJUSTMENT commissions
 *
 * They do not hold money separately and nothing is posted here. Withdrawals are still paid from the member's
 * single available balance, so the figures below are what each wallet has earned, not what is left to withdraw.
 * Corrections made by staff that are not tied to a commission count toward the main balance only.
 */

export const WALLET_OF: Record<CommissionType, "unilevel" | "bonus"> = {
  DIRECT: "unilevel",
  BINARY: "bonus",
  ADJUSTMENT: "bonus",
};

export interface SubWallet {
  /** Approved and counted toward the withdrawable balance (after reversals). */
  earnedMinor: number;
  /** Waiting for the refund window. */
  pendingMinor: number;
  /** Frozen by a dispute or by staff. */
  heldMinor: number;
}

function empty(): SubWallet {
  return { earnedMinor: 0, pendingMinor: 0, heldMinor: 0 };
}

/** Pure: adds per-commission-type bucket totals into the two wallets. */
export function splitWallets(rows: { type: CommissionType; pending: number; held: number; available: number }[]) {
  const out = { unilevel: empty(), bonus: empty() };
  for (const r of rows) {
    const w = out[WALLET_OF[r.type]];
    w.earnedMinor += r.available;
    w.pendingMinor += r.pending;
    w.heldMinor += r.held;
  }
  return out;
}

/** A member's Unilevel and Bonus wallets, straight from the ledger. */
export async function subWallets(userId: string, tx: Tx = prisma) {
  const rows = await tx.$queryRaw<{ type: CommissionType; pending: bigint; held: bigint; available: bigint }[]>`
    SELECT c.type,
      COALESCE(SUM(CASE WHEN e."toBucket" = 'PENDING' THEN e."amountMinor" ELSE 0 END) - SUM(CASE WHEN e."fromBucket" = 'PENDING' THEN e."amountMinor" ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN e."toBucket" = 'HELD' THEN e."amountMinor" ELSE 0 END) - SUM(CASE WHEN e."fromBucket" = 'HELD' THEN e."amountMinor" ELSE 0 END), 0) AS held,
      COALESCE(SUM(CASE WHEN e."toBucket" = 'AVAILABLE' THEN e."amountMinor" ELSE 0 END) - SUM(CASE WHEN e."fromBucket" = 'AVAILABLE' THEN e."amountMinor" ELSE 0 END), 0) AS available
    FROM "LedgerEntry" e JOIN "Commission" c ON c.id = e."commissionId"
    WHERE e."userId" = ${userId}
    GROUP BY c.type`;
  return splitWallets(rows.map((r) => ({ type: r.type, pending: Number(r.pending), held: Number(r.held), available: Number(r.available) })));
}
