import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import { AppError } from "./errors";
import { decrypt, encrypt } from "./crypto";
import { generateSecret, verifyCode } from "./totp";
import { sha256 } from "./auth";
import { audit } from "./audit";

export const MFA_REQUIRED_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;

export function mfaRequired(role: string) {
  return (MFA_REQUIRED_ROLES as readonly string[]).includes(role);
}

/** Step 1 of enrolment: a fresh secret, stored encrypted but not active until confirmed. */
export async function beginEnrolment(userId: string) {
  const secret = generateSecret();
  await prisma.user.update({ where: { id: userId }, data: { mfaSecretEnc: encrypt(secret), mfaEnabledAt: null } });
  return secret;
}

/** Step 2: user proves the app works. Returns one-time recovery codes (shown once). */
export async function confirmEnrolment(userId: string, code: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.mfaSecretEnc) throw new AppError("Start setup again.");
  if (user.mfaEnabledAt) throw new AppError("Two-step verification is already on.");
  const step = verifyCode(decrypt(user.mfaSecretEnc), code.trim());
  if (step === null) throw new AppError("That code didn't match. Check the time on your phone and try again.");
  const recovery = Array.from({ length: 8 }, () => randomBytes(5).toString("hex"));
  await prisma.user.update({
    where: { id: userId },
    data: { mfaEnabledAt: new Date(), mfaLastStep: step, mfaRecoveryHashes: recovery.map(sha256) },
  });
  await audit("mfa.enable", "User", userId, userId);
  return recovery;
}

/** Checks a TOTP code (no reuse) or a recovery code (single use). */
export async function checkSecondFactor(userId: string, input: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.mfaEnabledAt || !user.mfaSecretEnc) return false;
  const code = input.trim().replace(/\s/g, "");
  if (/^\d{6}$/.test(code)) {
    const step = verifyCode(decrypt(user.mfaSecretEnc), code);
    if (step === null || (user.mfaLastStep !== null && step <= user.mfaLastStep)) return false;
    // Conditional update so two concurrent submissions of the same code can't both pass.
    const r = await prisma.user.updateMany({ where: { id: userId, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: step } }] }, data: { mfaLastStep: step } });
    return r.count === 1;
  }
  const h = sha256(code.toLowerCase());
  if (!user.mfaRecoveryHashes.includes(h)) return false;
  await prisma.user.update({ where: { id: userId }, data: { mfaRecoveryHashes: user.mfaRecoveryHashes.filter((x) => x !== h) } });
  await audit("mfa.recoveryCodeUsed", "User", userId, userId);
  return true;
}

/** Emergency recovery by a super admin: clears MFA so the member re-enrols at next sign-in. */
export async function resetMfa(userId: string, actorId: string) {
  await prisma.user.update({ where: { id: userId }, data: { mfaSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryHashes: [] } });
  await prisma.session.deleteMany({ where: { userId } });
  await audit("mfa.reset", "User", userId, actorId);
}
