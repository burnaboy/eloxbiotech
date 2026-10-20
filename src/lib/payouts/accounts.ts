import { createHmac } from "node:crypto";
import type { PayoutAccount } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { AppError } from "../errors";
import { audit } from "../audit";
import { notify } from "../notify";
import { decrypt, encrypt } from "../crypto";
import { GatewayError } from "../payments/types";
import { bankDirectory } from "./banks";

/*
 * Member payout profile: one active bank account.
 *  - The account number is encrypted at rest (AES-256-GCM). Pages show it masked ("•••• 1234").
 *  - The full number is shown only to staff with the PAYOUT_DETAILS permission, and every view is audited.
 *  - A new or changed account can receive withdrawals only after a cooling-off period, and the member is
 *    told by email, so someone who takes over an account can't quietly redirect money.
 *  - No BVN, card numbers or other banking data is collected.
 */

export const COOLING_OFF_HOURS = 24;

export const accountInputSchema = z.object({
  bankCode: z.string().trim().regex(/^[0-9A-Za-z]{2,10}$/, "Choose your bank"),
  accountNumber: z.string().trim().regex(/^\d{10}$/, "Enter your 10-digit NUBAN account number"),
});

function fingerprint(bankCode: string, accountNumber: string) {
  return createHmac("sha256", process.env.APP_ENCRYPTION_KEY ?? "").update(`${bankCode}:${accountNumber}`).digest("hex");
}

export function maskedAccount(a: Pick<PayoutAccount, "bankName" | "accountLast4" | "accountName">) {
  return `${a.bankName} •••• ${a.accountLast4} (${a.accountName})`;
}

/** Loose check that the bank's account name belongs to the member: at least two name parts in common. */
export function nameMatches(accountName: string, memberName: string) {
  const parts = (s: string) => new Set(s.toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter((p) => p.length > 1));
  const a = parts(accountName);
  const common = [...parts(memberName)].filter((p) => a.has(p)).length;
  return common >= Math.min(2, a.size);
}

export async function activeAccount(userId: string) {
  return prisma.payoutAccount.findFirst({ where: { userId, status: "ACTIVE" } });
}

/** Adds or replaces the member's bank account, after checking it with the bank directory where possible. */
export async function savePayoutAccount(userId: string, raw: z.input<typeof accountInputSchema>) {
  const input = accountInputSchema.parse(raw);
  const dir = bankDirectory();
  const bank = (await dir.listBanks()).find((b) => b.code === input.bankCode);
  if (!bank) throw new AppError("Choose your bank from the list.");
  let accountName: string | null;
  try {
    accountName = await dir.resolveAccount(bank.code, input.accountNumber);
  } catch (e) {
    if (e instanceof GatewayError) throw new AppError(e.definite ? "We couldn't find that account. Check the bank and account number." : e.message);
    throw e;
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const fp = fingerprint(bank.code, input.accountNumber);
  const now = new Date();
  const account = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payout-account:${userId}`}))`;
    const open = await tx.payout.count({ where: { userId, status: { in: ["REQUESTED", "APPROVED", "PROCESSING"] } } });
    if (open > 0) throw new AppError("You have a withdrawal in progress. You can change your bank account once it's finished.");
    const prev = await tx.payoutAccount.findFirst({ where: { userId, status: "ACTIVE" } });
    if (prev) await tx.payoutAccount.update({ where: { id: prev.id }, data: { status: "REMOVED", removedAt: now } });
    const created = await tx.payoutAccount.create({
      data: {
        userId,
        bankCode: bank.code,
        bankName: bank.name,
        accountNumberEnc: encrypt(input.accountNumber),
        accountLast4: input.accountNumber.slice(-4),
        fingerprint: fp,
        accountName: accountName ?? user.name,
        verifiedBy: accountName ? dir.name : null,
        verifiedAt: accountName ? now : null,
        usableFrom: new Date(now.getTime() + COOLING_OFF_HOURS * 3600e3),
      },
    });
    const shared = await tx.payoutAccount.count({ where: { fingerprint: fp, userId: { not: userId } } });
    await audit(prev ? "payoutAccount.change" : "payoutAccount.add", "PayoutAccount", created.id, userId, { bank: bank.name, last4: created.accountLast4, verifiedBy: created.verifiedBy, nameMatches: nameMatches(created.accountName, user.name), sharedWithOtherMembers: shared }, tx);
    await notify(userId, prev ? "Your payout bank account was changed" : "Payout bank account added", `Withdrawals will go to ${maskedAccount(created)} from ${COOLING_OFF_HOURS} hours from now. If you didn't make this change, contact support immediately.`, "/dashboard/payouts", tx, "account");
    return created;
  });
  return account;
}

export async function removePayoutAccount(userId: string) {
  return prisma.$transaction(async (tx) => {
    const open = await tx.payout.count({ where: { userId, status: { in: ["REQUESTED", "APPROVED", "PROCESSING"] } } });
    if (open > 0) throw new AppError("You have a withdrawal in progress. Remove the account once it's finished.");
    const a = await tx.payoutAccount.findFirst({ where: { userId, status: "ACTIVE" } });
    if (!a) return;
    await tx.payoutAccount.update({ where: { id: a.id }, data: { status: "REMOVED", removedAt: new Date() } });
    await audit("payoutAccount.remove", "PayoutAccount", a.id, userId, { last4: a.accountLast4 }, tx);
  });
}

/** Full account number for authorised staff. Callers check the PAYOUT_DETAILS permission; every view is logged. */
export async function revealAccountNumber(accountId: string, actorId: string, purpose: string) {
  const a = await prisma.payoutAccount.findUniqueOrThrow({ where: { id: accountId } });
  await audit("payoutAccount.reveal", "PayoutAccount", a.id, actorId, { purpose, privileged: true });
  return decrypt(a.accountNumberEnc);
}

/** For the risk page: bank accounts used by more than one member. */
export async function sharedAccounts() {
  return prisma.$queryRaw<{ fingerprint: string; members: number; last4: string; bankName: string }[]>`
    SELECT fingerprint, COUNT(DISTINCT "userId")::int AS members, MIN("accountLast4") AS last4, MIN("bankName") AS "bankName"
    FROM "PayoutAccount" GROUP BY fingerprint HAVING COUNT(DISTINCT "userId") > 1 LIMIT 50`;
}
