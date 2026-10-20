import { randomUUID } from "node:crypto";
import type { PayoutStatus } from "@prisma/client";
import { z } from "zod";
import { prisma, type Tx } from "./db";
import { AppError } from "./errors";
import { getOps, getShopSettings } from "./settings";
import { nairaCell, toCsv } from "./csv";
import { audit } from "./audit";
import { notify } from "./notify";
import { requireVerified } from "./email-verification";
import { balances, lockWallet, post } from "./ledger";
import { formatMoney } from "./money";
import { decrypt } from "./crypto";
import { activeAccount, maskedAccount } from "./payouts/accounts";

/*
 * Wallet and withdrawals. Balances come straight from the ledger (ledger.ts); nothing here keeps its own total.
 *
 *   REQUESTED   member asks; the amount moves AVAILABLE → RESERVED at once under a per-member lock, so it can
 *               never exceed what is available. One open withdrawal per member (unique index).
 *   APPROVED    reviewed by staff with the Payouts permission (never the member themselves)
 *   PROCESSING  added to a payout batch and sent to the bank
 *   PAID        settlement recorded with a unique transfer reference, date and evidence: RESERVED → PAID_OUT
 *   REJECTED / FAILED   RESERVED → AVAILABLE; a failed transfer can be queued again
 * Transfers are made outside the app (bank bulk transfer). A provider integration (e.g. Paystack Transfers)
 * can be added once that workflow is approved; it would record settlementSource = "provider".
 */

export async function walletBalance(userId: string, tx: Tx = prisma) {
  const b = await balances(userId, tx);
  return {
    pendingMinor: b.PENDING,
    heldMinor: b.HELD,
    availableMinor: b.AVAILABLE,
    reservedMinor: b.RESERVED,
    paidOutMinor: b.PAID_OUT,
    reversedMinor: b.REVERSED,
    /** Everything approved for the member so far, whether still in the wallet, reserved or paid out. */
    earnedMinor: b.AVAILABLE + b.RESERVED + b.PAID_OUT,
  };
}

export const payoutSchema = z.object({
  amountMinor: z.number().int().positive(),
});

const keySchema = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
const OPEN: PayoutStatus[] = ["REQUESTED", "APPROVED", "PROCESSING"];

/**
 * Requests a withdrawal to the member's verified bank account and reserves the funds in the same
 * transaction. `requestKey` comes from the form, so a double-submitted request returns the first payout.
 * Only one withdrawal can be open at a time (also enforced by a unique index).
 */
export async function requestPayout(userId: string, raw: z.input<typeof payoutSchema>, requestKey?: string) {
  const input = payoutSchema.parse(raw);
  const key = requestKey ? `${userId}:${keySchema.parse(requestKey)}` : null;
  if (key) {
    const existing = await prisma.payout.findUnique({ where: { requestKey: key } });
    if (existing) return existing;
  }
  const [shop, ops] = await Promise.all([getShopSettings(), getOps()]);
  if (ops.payoutsPaused) throw new AppError("Payouts are temporarily paused. Please try again later.");
  if (input.amountMinor < shop.minPayoutMinor) throw new AppError("Amount is below the minimum payout.");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  requireVerified(user, "requesting a payout");
  if (user.status !== "ACTIVE") throw new AppError("Your account can't request payouts right now. Please contact support.");
  const account = await activeAccount(userId);
  if (!account) throw new AppError("Add the bank account you want to be paid into first.");
  if (account.usableFrom > new Date()) throw new AppError(`For your security, a new bank account can receive withdrawals from ${account.usableFrom.toLocaleString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "medium", timeStyle: "short" })}.`);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockWallet(tx, userId);
      if (key) {
        const existing = await tx.payout.findUnique({ where: { requestKey: key } });
        if (existing) return existing;
      }
      if (await tx.payout.count({ where: { userId, status: { in: OPEN } } })) throw new AppError("You already have a withdrawal in progress.");
      const { AVAILABLE } = await balances(userId, tx);
      if (input.amountMinor > AVAILABLE) throw new AppError("Amount is more than your available balance.");
      const payout = await tx.payout.create({
        data: { userId, amountMinor: input.amountMinor, method: "BANK_TRANSFER", destination: maskedAccount(account), payoutAccountId: account.id, requestKey: key },
      });
      await post(tx, [{ userId, type: "WITHDRAWAL_RESERVED", amountMinor: input.amountMinor, from: "AVAILABLE", to: "RESERVED", sourceType: "Payout", sourceId: payout.id, payoutId: payout.id, idempotencyKey: `payout:${payout.id}:reserved:1`, actorId: userId }]);
      await audit("payout.request", "Payout", payout.id, userId, { amountMinor: input.amountMinor, account: account.id }, tx);
      await notify(userId, "Withdrawal requested", `Your withdrawal of ${formatMoney(input.amountMinor)} to ${payout.destination} is waiting for review.`, "/dashboard/payouts", tx);
      return payout;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      if (key) {
        const existing = await prisma.payout.findUnique({ where: { requestKey: key } });
        if (existing) return existing;
      }
      throw new AppError("You already have a withdrawal in progress.");
    }
    throw e;
  }
}

async function load(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "Payout" WHERE id = ${id} FOR UPDATE`;
  return tx.payout.findUniqueOrThrow({ where: { id }, include: { user: { select: { status: true, name: true } }, payoutAccount: true } });
}

function release(tx: Tx, p: { id: string; userId: string; amountMinor: number; attempt: number }, memo: string, actorId: string | null) {
  return post(tx, [{ userId: p.userId, type: "WITHDRAWAL_RELEASED", amountMinor: p.amountMinor, from: "RESERVED", to: "AVAILABLE", sourceType: "Payout", sourceId: p.id, payoutId: p.id, idempotencyKey: `payout:${p.id}:released:${p.attempt}`, memo, actorId }]);
}

/**
 * Review: approve or reject a requested withdrawal. Callers check the PAYOUTS permission and a recent
 * second-factor check. Nobody can review their own withdrawal. If the bank account couldn't be verified
 * automatically, the reviewer must confirm they checked it.
 */
export async function reviewPayout(id: string, decision: "APPROVE" | "REJECT", actorId: string, opts: { note?: string; accountChecked?: boolean } = {}) {
  const note = opts.note?.trim().slice(0, 300) || undefined;
  if (decision === "REJECT" && !note) throw new AppError("Give a reason; the member will see it.");
  return prisma.$transaction(async (tx) => {
    const p = await load(tx, id);
    if (p.userId === actorId) throw new AppError("You can't review your own withdrawal.");
    const from: PayoutStatus[] = decision === "APPROVE" ? ["REQUESTED"] : ["REQUESTED", "APPROVED"];
    if (!from.includes(p.status)) throw new AppError(`This withdrawal is already ${p.status.toLowerCase()}.`);
    if (decision === "APPROVE") {
      if (p.user.status !== "ACTIVE") throw new AppError("This member's account isn't active. Reject the withdrawal or reactivate the account first.");
      if (!p.payoutAccount || p.payoutAccount.status !== "ACTIVE") throw new AppError("The bank account for this withdrawal was removed. Reject it so the member can request again.");
      if (!p.payoutAccount.verifiedAt && !opts.accountChecked) throw new AppError("This bank account wasn't verified automatically. Confirm you've checked the account name before approving.");
      await tx.payout.update({ where: { id }, data: { status: "APPROVED", reviewedById: actorId, reviewedAt: new Date(), note: note ?? p.note } });
      await audit("payout.approved", "Payout", id, actorId, { amountMinor: p.amountMinor, accountChecked: !!opts.accountChecked, privileged: true }, tx);
      await notify(p.userId, "Withdrawal approved", `Your withdrawal of ${formatMoney(p.amountMinor)} was approved and will be sent in the next payout batch.`, "/dashboard/payouts", tx);
      return;
    }
    await tx.payout.update({ where: { id }, data: { status: "REJECTED", reviewedById: actorId, reviewedAt: new Date(), failureReason: note, note } });
    await release(tx, p, note!, actorId);
    await audit("payout.rejected", "Payout", id, actorId, { amountMinor: p.amountMinor, note, privileged: true }, tx);
    await notify(p.userId, "Withdrawal rejected", `Your withdrawal of ${formatMoney(p.amountMinor)} was rejected: ${note}. The amount is back in your wallet.`, "/dashboard/payouts", tx);
  });
}

function batchNumber() {
  const d = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  return `PB${d}-${randomUUID().slice(0, 6).toUpperCase()}`;
}

/** Puts approved withdrawals into a new batch to be sent. Each payout can be in one batch only. */
export async function createPayoutBatch(payoutIds: string[], actorId: string) {
  if ((await getOps()).payoutsPaused) throw new AppError("Payouts are paused.");
  const ids = [...new Set(payoutIds)].slice(0, 500);
  if (!ids.length) throw new AppError("Choose at least one approved withdrawal.");
  return prisma.$transaction(async (tx) => {
    const rows = await tx.payout.findMany({ where: { id: { in: ids } } });
    if (rows.length !== ids.length || rows.some((p) => p.status !== "APPROVED" || p.batchId)) throw new AppError("Only approved withdrawals that aren't in a batch can be added. Reload and try again.", 409);
    if (rows.some((p) => p.userId === actorId)) throw new AppError("You can't batch your own withdrawal.");
    const batch = await tx.payoutBatch.create({ data: { number: batchNumber(), totalMinor: rows.reduce((s, p) => s + p.amountMinor, 0), count: rows.length, createdById: actorId } });
    const moved = await tx.payout.updateMany({ where: { id: { in: ids }, status: "APPROVED", batchId: null }, data: { status: "PROCESSING", batchId: batch.id, processedById: actorId, processedAt: new Date() } });
    if (moved.count !== ids.length) throw new AppError("Some withdrawals were just changed by someone else. Reload and try again.", 409);
    for (const p of rows) await notify(p.userId, "Withdrawal on its way", `Your withdrawal of ${formatMoney(p.amountMinor)} is being sent to your bank.`, "/dashboard/payouts", tx);
    await audit("payoutBatch.create", "PayoutBatch", batch.id, actorId, { number: batch.number, count: rows.length, totalMinor: batch.totalMinor, privileged: true }, tx);
    return batch;
  });
}

/**
 * The transfer file for the bank: full account numbers, so only for PAYOUT_DETAILS staff (callers check).
 * Each download is audited.
 */
export async function batchTransferCsv(batchId: string, actorId: string) {
  const batch = await prisma.payoutBatch.findUniqueOrThrow({ where: { id: batchId }, include: { payouts: { where: { status: "PROCESSING" }, include: { payoutAccount: true }, orderBy: { createdAt: "asc" } } } });
  const rows: unknown[][] = [];
  for (const p of batch.payouts) {
    const a = p.payoutAccount;
    if (!a) continue;
    rows.push([p.id, a.bankCode, a.bankName, decrypt(a.accountNumberEnc), a.accountName, nairaCell(p.amountMinor), `${batch.number} ${p.id.slice(-6)}`]);
  }
  await prisma.$transaction(async (tx) => {
    await tx.payoutBatch.updateMany({ where: { id: batchId, status: "OPEN" }, data: { status: "EXPORTED", exportedAt: new Date(), exportedById: actorId } });
    await audit("payoutBatch.export", "PayoutBatch", batchId, actorId, { number: batch.number, rows: batch.payouts.length, privileged: true }, tx);
  });
  // Names come from the bank but are still escaped, so a crafted account name can't run as a spreadsheet formula.
  const csv = toCsv(["payout_id", "bank_code", "bank_name", "account_number", "account_name", "amount_naira", "narration"], rows, { bom: false });
  return { filename: `${batch.number}.csv`, csv };
}

async function closeBatchIfDone(tx: Tx, batchId: string | null) {
  if (!batchId) return;
  const open = await tx.payout.count({ where: { batchId, status: "PROCESSING" } });
  if (open === 0) await tx.payoutBatch.updateMany({ where: { id: batchId, status: { not: "CLOSED" } }, data: { status: "CLOSED", closedAt: new Date() } });
}

export const settlementSchema = z.object({
  reference: z.string().trim().min(4, "Enter the bank or provider transfer reference").max(100),
  settledAt: z.coerce.date(),
  evidence: z.string().trim().min(10, "Describe the evidence: e.g. the statement line or transfer receipt you checked").max(500),
});

/**
 * Records a withdrawal as paid. This is never just a click: it needs the transfer reference (unique across
 * all payouts), the settlement date and a description of the evidence checked (bank statement line or
 * transfer receipt). A database constraint refuses PAID without them.
 */
export async function settlePayout(id: string, actorId: string, raw: z.input<typeof settlementSchema>) {
  const input = settlementSchema.parse(raw);
  if (input.settledAt.getTime() > Date.now() + 5 * 60e3) throw new AppError("The settlement date can't be in the future.");
  try {
    return await prisma.$transaction(async (tx) => {
      const p = await load(tx, id);
      if (p.userId === actorId) throw new AppError("You can't confirm your own withdrawal.");
      if (p.status !== "PROCESSING") throw new AppError(p.status === "APPROVED" ? "Add this withdrawal to a payout batch and send it first." : `This withdrawal is ${p.status.toLowerCase()}.`);
      if (input.settledAt < p.createdAt) throw new AppError("The settlement date is before the withdrawal was requested.");
      await tx.payout.update({ where: { id }, data: { status: "PAID", reference: input.reference, settledAt: input.settledAt, settlementSource: "bank", settlementEvidence: input.evidence, processedById: actorId, processedAt: new Date() } });
      await post(tx, [{ userId: p.userId, type: "WITHDRAWAL_PAID", amountMinor: p.amountMinor, from: "RESERVED", to: "PAID_OUT", sourceType: "Payout", sourceId: id, payoutId: id, idempotencyKey: `payout:${id}:paid`, memo: input.reference, actorId }]);
      await closeBatchIfDone(tx, p.batchId);
      await audit("payout.paid", "Payout", id, actorId, { amountMinor: p.amountMinor, reference: input.reference, settledAt: input.settledAt.toISOString(), evidence: input.evidence, privileged: true }, tx);
      await notify(p.userId, "Withdrawal paid", `${formatMoney(p.amountMinor)} was sent to ${p.destination}. Reference: ${input.reference}.`, "/dashboard/payouts", tx);
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new AppError("That transfer reference is already recorded against another withdrawal.");
    throw e;
  }
}

/** The transfer failed or bounced: the money goes back to the member's wallet. */
export async function failPayout(id: string, actorId: string, reason: string) {
  const why = reason.trim().slice(0, 300);
  if (why.length < 5) throw new AppError("Say why it failed; the member will see it.");
  return prisma.$transaction(async (tx) => {
    const p = await load(tx, id);
    if (p.status !== "PROCESSING") throw new AppError("Only withdrawals being sent can be marked failed.");
    await tx.payout.update({ where: { id }, data: { status: "FAILED", failureReason: why, processedById: actorId, processedAt: new Date() } });
    await release(tx, p, why, actorId);
    await closeBatchIfDone(tx, p.batchId);
    await audit("payout.failed", "Payout", id, actorId, { amountMinor: p.amountMinor, reason: why, privileged: true }, tx);
    await notify(p.userId, "Withdrawal failed", `Your withdrawal of ${formatMoney(p.amountMinor)} couldn't be completed: ${why}. The amount is back in your wallet.`, "/dashboard/payouts", tx);
  });
}

/** Failed payout recovery: queue the same withdrawal again (funds reserved again) once the problem is fixed. */
export async function requeuePayout(id: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const p = await load(tx, id);
    if (p.status !== "FAILED") throw new AppError("Only failed withdrawals can be sent again.");
    if (p.userId === actorId) throw new AppError("You can't process your own withdrawal.");
    if (!p.payoutAccount || p.payoutAccount.status !== "ACTIVE") throw new AppError("The member has changed or removed that bank account. They can request a new withdrawal.");
    await lockWallet(tx, p.userId);
    if (await tx.payout.count({ where: { userId: p.userId, status: { in: OPEN } } })) throw new AppError("The member already has another withdrawal in progress.");
    const { AVAILABLE } = await balances(p.userId, tx);
    if (AVAILABLE < p.amountMinor) throw new AppError("The member's available balance no longer covers this amount.");
    const attempt = p.attempt + 1;
    await tx.payout.update({ where: { id }, data: { status: "APPROVED", attempt, batchId: null, failureReason: null, reviewedById: actorId, reviewedAt: new Date() } });
    await post(tx, [{ userId: p.userId, type: "WITHDRAWAL_RESERVED", amountMinor: p.amountMinor, from: "AVAILABLE", to: "RESERVED", sourceType: "Payout", sourceId: id, payoutId: id, idempotencyKey: `payout:${id}:reserved:${attempt}`, memo: "Sent again after a failed transfer", actorId }]);
    await audit("payout.requeue", "Payout", id, actorId, { attempt, privileged: true }, tx);
    await notify(p.userId, "Withdrawal being sent again", `We're sending your withdrawal of ${formatMoney(p.amountMinor)} again.`, "/dashboard/payouts", tx);
  });
}

/** A member withdraws their own request before it is reviewed. */
export async function cancelPayout(userId: string, id: string) {
  return prisma.$transaction(async (tx) => {
    const moved = await tx.payout.updateMany({ where: { id, userId, status: "REQUESTED" }, data: { status: "REJECTED", failureReason: "Cancelled by member", note: "Cancelled by member" } });
    if (moved.count === 0) throw new AppError("Only withdrawals that haven't been reviewed yet can be cancelled.");
    const p = await tx.payout.findUniqueOrThrow({ where: { id } });
    await release(tx, p, "Cancelled by member", userId);
    await audit("payout.cancel", "Payout", id, userId, { amountMinor: p.amountMinor }, tx);
  });
}

export const correctionSchema = z.object({
  /** Positive credits the member's available balance, negative debits it. */
  amountMinor: z.number().int().refine((n) => n !== 0, "Amount can't be zero"),
  reason: z.string().trim().min(10, "Explain the correction (10+ characters)").max(500),
});

/**
 * Administrative correction: a documented compensating entry, never an edit. A debit may take the available
 * balance below zero (money owed back); it is then recovered from future earnings before any withdrawal.
 * `formKey` makes a double-submitted correction post once.
 */
export async function adjustWallet(userId: string, raw: z.input<typeof correctionSchema>, actorId: string, formKey: string = randomUUID()) {
  const input = correctionSchema.parse(raw);
  if (userId === actorId) throw new AppError("You can't correct your own wallet.");
  return prisma.$transaction(async (tx) => {
    await lockWallet(tx, userId);
    await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const record = await audit("wallet.correction", "User", userId, actorId, { amountMinor: input.amountMinor, reason: input.reason, privileged: true }, tx);
    const credit = input.amountMinor > 0;
    const n = await post(tx, [{
      userId,
      type: "ADMIN_CORRECTION",
      amountMinor: Math.abs(input.amountMinor),
      from: credit ? null : "AVAILABLE",
      to: credit ? "AVAILABLE" : null,
      sourceType: "AuditLog",
      sourceId: record.id,
      idempotencyKey: `correction:${userId}:${formKey}`,
      memo: input.reason,
      actorId,
    }]);
    if (n === 0) throw new AppError("This correction was already posted.");
    await notify(userId, credit ? "Wallet credited" : "Wallet deduction", `${credit ? "An adjustment was added to" : "An adjustment was deducted from"} your wallet: ${input.reason}`, "/dashboard/commissions", tx, "commission");
    return record;
  });
}
