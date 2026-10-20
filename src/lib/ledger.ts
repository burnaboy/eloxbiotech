import type { LedgerBucket, LedgerType, Prisma } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { audit } from "./audit";

/*
 * The money ledger. Every change to a member's money is one LedgerEntry, and entries are never edited or
 * deleted (a database trigger refuses it). Mistakes are fixed with a new, compensating entry.
 *
 * SIGN CONVENTION
 *   Every entry moves a positive amount `from` one bucket `to` another, for one member.
 *   A bucket's balance = Σ amounts flowing in − Σ amounts flowing out.
 *   `from = null` means money entering the wallet (a commission is earned, a correction credit);
 *   `to = null` means money leaving it without being paid out (a correction debit).
 *
 * BUCKETS
 *   PENDING    earned on a paid order, inside the refund window
 *   HELD       frozen by a dispute or by staff
 *   AVAILABLE  approved and withdrawable (can go below zero only when a reversal claws back money already paid out)
 *   RESERVED   set aside by a payout request until it is paid or released
 *   PAID_OUT   sent to the member
 *   REVERSED   taken back after a refund or chargeback
 *
 * Moves used by the app:
 *   COMMISSION_EARNED     null → PENDING (direct) or null → AVAILABLE (binary)
 *   COMMISSION_APPROVED   PENDING → AVAILABLE
 *   COMMISSION_HELD       PENDING | AVAILABLE → HELD
 *   COMMISSION_RELEASED   HELD → PENDING | AVAILABLE
 *   COMMISSION_REVERSED   PENDING | HELD | AVAILABLE → REVERSED
 *   WITHDRAWAL_RESERVED   AVAILABLE → RESERVED
 *   WITHDRAWAL_PAID       RESERVED → PAID_OUT
 *   WITHDRAWAL_RELEASED   RESERVED → AVAILABLE
 *   ADMIN_CORRECTION      null → AVAILABLE (credit) or AVAILABLE → null (debit)
 *
 * Every entry has a source (sourceType + sourceId) and an idempotency key that is unique in the database,
 * so a retried request or a replayed gateway event can never post the same money twice.
 */

export const BUCKETS: LedgerBucket[] = ["PENDING", "HELD", "AVAILABLE", "RESERVED", "PAID_OUT", "REVERSED"];

const ALLOWED: Record<LedgerType, [LedgerBucket | null, LedgerBucket | null][]> = {
  COMMISSION_EARNED: [[null, "PENDING"], [null, "AVAILABLE"]],
  COMMISSION_APPROVED: [["PENDING", "AVAILABLE"]],
  COMMISSION_HELD: [["PENDING", "HELD"], ["AVAILABLE", "HELD"]],
  COMMISSION_RELEASED: [["HELD", "PENDING"], ["HELD", "AVAILABLE"]],
  COMMISSION_REVERSED: [["PENDING", "REVERSED"], ["HELD", "REVERSED"], ["AVAILABLE", "REVERSED"]],
  WITHDRAWAL_RESERVED: [["AVAILABLE", "RESERVED"]],
  WITHDRAWAL_PAID: [["RESERVED", "PAID_OUT"]],
  WITHDRAWAL_RELEASED: [["RESERVED", "AVAILABLE"]],
  ADMIN_CORRECTION: [[null, "AVAILABLE"], ["AVAILABLE", null]],
};

export interface Posting {
  userId: string;
  type: LedgerType;
  amountMinor: number;
  from: LedgerBucket | null;
  to: LedgerBucket | null;
  sourceType: string;
  sourceId: string;
  idempotencyKey: string;
  commissionId?: string | null;
  payoutId?: string | null;
  memo?: string | null;
  actorId?: string | null;
}

export function checkPosting(p: Posting) {
  if (!Number.isSafeInteger(p.amountMinor) || p.amountMinor <= 0) throw new Error(`Ledger amount must be a positive whole number of kobo (got ${p.amountMinor})`);
  if (!ALLOWED[p.type].some(([f, t]) => f === p.from && t === p.to)) throw new Error(`Ledger move ${p.type} ${p.from ?? "∅"} → ${p.to ?? "∅"} is not allowed`);
  if (!p.idempotencyKey || !p.sourceType || !p.sourceId) throw new Error("Ledger entries need a source and an idempotency key");
}

/**
 * Posts entries. Returns how many were new: an entry whose idempotency key already exists is skipped
 * (ON CONFLICT DO NOTHING, so the surrounding transaction is not aborted).
 */
export async function post(tx: Tx, postings: Posting[]) {
  const rows = postings.filter((p) => p.amountMinor !== 0);
  rows.forEach(checkPosting);
  if (!rows.length) return 0;
  const res = await tx.ledgerEntry.createMany({
    data: rows.map((p) => ({
      userId: p.userId,
      type: p.type,
      amountMinor: p.amountMinor,
      fromBucket: p.from,
      toBucket: p.to,
      sourceType: p.sourceType,
      sourceId: p.sourceId,
      idempotencyKey: p.idempotencyKey,
      commissionId: p.commissionId ?? null,
      payoutId: p.payoutId ?? null,
      memo: p.memo ?? null,
      actorId: p.actorId ?? null,
    })),
    skipDuplicates: true,
  });
  return res.count;
}

export type Balances = Record<LedgerBucket, number>;

function emptyBalances(): Balances {
  return { PENDING: 0, HELD: 0, AVAILABLE: 0, RESERVED: 0, PAID_OUT: 0, REVERSED: 0 };
}

/** Pure: balances from a list of entries. */
export function balancesOf(entries: { amountMinor: number; fromBucket: LedgerBucket | null; toBucket: LedgerBucket | null }[]) {
  const b = emptyBalances();
  for (const e of entries) {
    if (e.toBucket) b[e.toBucket] += e.amountMinor;
    if (e.fromBucket) b[e.fromBucket] -= e.amountMinor;
  }
  return b;
}

async function sumsBy(tx: Tx, where: Prisma.LedgerEntryWhereInput) {
  const [inflow, outflow] = await Promise.all([
    tx.ledgerEntry.groupBy({ by: ["toBucket"], where: { ...where, toBucket: { not: null } }, _sum: { amountMinor: true } }),
    tx.ledgerEntry.groupBy({ by: ["fromBucket"], where: { ...where, fromBucket: { not: null } }, _sum: { amountMinor: true } }),
  ]);
  const b = emptyBalances();
  for (const r of inflow) b[r.toBucket!] += r._sum.amountMinor ?? 0;
  for (const r of outflow) b[r.fromBucket!] -= r._sum.amountMinor ?? 0;
  return b;
}

/** A member's balances, straight from the ledger. */
export function balances(userId: string, tx: Tx = prisma) {
  return sumsBy(tx, { userId });
}

/** Where one commission's money currently sits. */
export function commissionBalances(commissionId: string, tx: Tx = prisma) {
  return sumsBy(tx, { commissionId });
}

/** The single bucket a commission's money sits in (commissions move as a whole). */
export async function commissionBucket(tx: Tx, commissionId: string): Promise<LedgerBucket | null> {
  const b = await commissionBalances(commissionId, tx);
  const live = (["PENDING", "HELD", "AVAILABLE"] as const).filter((k) => b[k] !== 0);
  if (live.length > 1) throw new AppError("This commission's ledger entries don't add up. Run the ledger check.", 500);
  return live[0] ?? null;
}

/** Serialises everything that spends or reserves a member's available balance. */
export async function lockWallet(tx: Tx, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet:${userId}`}))`;
}

export const LEDGER_LABEL: Record<LedgerType, string> = {
  COMMISSION_EARNED: "Commission earned",
  COMMISSION_APPROVED: "Commission approved",
  COMMISSION_HELD: "Commission held",
  COMMISSION_RELEASED: "Commission released",
  COMMISSION_REVERSED: "Commission reversed",
  WITHDRAWAL_RESERVED: "Withdrawal requested",
  WITHDRAWAL_PAID: "Withdrawal paid",
  WITHDRAWAL_RELEASED: "Withdrawal released",
  ADMIN_CORRECTION: "Correction",
};

/** The effect of an entry on the member's withdrawable balance: +, − or 0. */
export function availableEffect(e: { amountMinor: number; fromBucket: LedgerBucket | null; toBucket: LedgerBucket | null }) {
  return (e.toBucket === "AVAILABLE" ? e.amountMinor : 0) - (e.fromBucket === "AVAILABLE" ? e.amountMinor : 0);
}

export interface LedgerProblem {
  kind: string;
  userId?: string;
  ref?: string;
  detail: string;
}

/**
 * Checks the ledger against the records it mirrors:
 *  - every commission's money sits in the bucket its status says, for its effective amount (amount − reversed)
 *  - every member's RESERVED equals their open payouts and PAID_OUT equals their paid payouts
 *  - no member's PENDING, HELD, RESERVED or PAID_OUT is negative
 */
export async function reconcileLedger(actorId: string | null = null): Promise<{ ok: boolean; problems: LedgerProblem[]; totals: Balances; members: number }> {
  const problems: LedgerProblem[] = [];
  const perCommission = await prisma.$queryRaw<{ id: string; userId: string; status: string; amountMinor: number; reversedMinor: number; type: string; pending: bigint; held: bigint; available: bigint; reversed: bigint }[]>`
    SELECT c.id, c."userId", c.status::text AS status, c."amountMinor", c."reversedMinor", c.type::text AS type,
      COALESCE(SUM(CASE WHEN e."toBucket" = 'PENDING' THEN e."amountMinor" ELSE 0 END) - SUM(CASE WHEN e."fromBucket" = 'PENDING' THEN e."amountMinor" ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN e."toBucket" = 'HELD' THEN e."amountMinor" ELSE 0 END) - SUM(CASE WHEN e."fromBucket" = 'HELD' THEN e."amountMinor" ELSE 0 END), 0) AS held,
      COALESCE(SUM(CASE WHEN e."toBucket" = 'AVAILABLE' THEN e."amountMinor" ELSE 0 END) - SUM(CASE WHEN e."fromBucket" = 'AVAILABLE' THEN e."amountMinor" ELSE 0 END), 0) AS available,
      COALESCE(SUM(CASE WHEN e."toBucket" = 'REVERSED' THEN e."amountMinor" ELSE 0 END) - SUM(CASE WHEN e."fromBucket" = 'REVERSED' THEN e."amountMinor" ELSE 0 END), 0) AS reversed
    FROM "Commission" c LEFT JOIN "LedgerEntry" e ON e."commissionId" = c.id
    WHERE c."amountMinor" > 0
    GROUP BY c.id`;
  for (const c of perCommission) {
    const eff = c.amountMinor - c.reversedMinor;
    const got = { PENDING: Number(c.pending), HELD: Number(c.held), AVAILABLE: Number(c.available), REVERSED: Number(c.reversed) };
    const want = { PENDING: 0, HELD: 0, AVAILABLE: 0, REVERSED: c.reversedMinor };
    if (c.status === "PENDING") want.PENDING = eff;
    else if (c.status === "HELD") want.HELD = eff;
    else if (c.status === "APPROVED" || c.status === "PAID") want.AVAILABLE = eff;
    for (const k of Object.keys(want) as (keyof typeof want)[]) {
      if (got[k] !== want[k]) {
        problems.push({ kind: "commission", userId: c.userId, ref: c.id, detail: `${c.type} commission (${c.status.toLowerCase()}): ${k.toLowerCase()} is ${got[k]} in the ledger, expected ${want[k]}` });
        break;
      }
    }
  }

  const perUser = await prisma.$queryRaw<{ userId: string; bucket: LedgerBucket; balance: bigint }[]>`
    SELECT "userId", bucket, SUM(amount) AS balance FROM (
      SELECT "userId", "toBucket" AS bucket, "amountMinor" AS amount FROM "LedgerEntry" WHERE "toBucket" IS NOT NULL
      UNION ALL
      SELECT "userId", "fromBucket", -"amountMinor" FROM "LedgerEntry" WHERE "fromBucket" IS NOT NULL
    ) x GROUP BY "userId", bucket`;
  const byUser = new Map<string, Balances>();
  const totals = emptyBalances();
  for (const r of perUser) {
    const b = byUser.get(r.userId) ?? emptyBalances();
    b[r.bucket] = Number(r.balance);
    totals[r.bucket] += Number(r.balance);
    byUser.set(r.userId, b);
  }
  const payouts = await prisma.payout.groupBy({ by: ["userId", "status"], _sum: { amountMinor: true } });
  const payoutUsers = new Set(payouts.map((p) => p.userId));
  for (const userId of new Set([...byUser.keys(), ...payoutUsers])) {
    const b = byUser.get(userId) ?? emptyBalances();
    const sum = (statuses: string[]) => payouts.filter((p) => p.userId === userId && statuses.includes(p.status)).reduce((s, p) => s + (p._sum.amountMinor ?? 0), 0);
    const open = sum(["REQUESTED", "APPROVED", "PROCESSING"]);
    const paid = sum(["PAID"]);
    if (b.RESERVED !== open) problems.push({ kind: "payout", userId, detail: `Reserved is ${b.RESERVED} in the ledger but open payouts total ${open}` });
    if (b.PAID_OUT !== paid) problems.push({ kind: "payout", userId, detail: `Paid out is ${b.PAID_OUT} in the ledger but paid payouts total ${paid}` });
    for (const k of ["PENDING", "HELD", "RESERVED", "PAID_OUT", "REVERSED"] as const) {
      if (b[k] < 0) problems.push({ kind: "negative", userId, detail: `${k.toLowerCase()} balance is negative (${b[k]})` });
    }
  }
  const result = { ok: problems.length === 0, problems, totals, members: byUser.size };
  await audit("ledger.reconcile", "Ledger", "all", actorId, { ok: result.ok, problemCount: problems.length, problems: problems.slice(0, 100), totals, members: result.members, commissions: perCommission.length } as unknown as Prisma.InputJsonObject);
  return result;
}
