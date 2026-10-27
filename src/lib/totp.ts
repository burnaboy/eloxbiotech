import "server-only";
import * as OTPAuth from "otpauth";

/*
 * RFC 6238 time-based codes (SHA-1, 6 digits, 30 s), compatible with Google Authenticator, Authy,
 * 1Password and others. The algorithm comes from the maintained `otpauth` library; this file only fixes
 * the settings and the replay rule (each time step can be used once, tracked in mfa.ts).
 */

const SETTINGS = { algorithm: "SHA1", digits: 6, period: 30 } as const;

function totp(secret: string, label = "", issuer = "") {
  return new OTPAuth.TOTP({ ...SETTINGS, secret: OTPAuth.Secret.fromBase32(secret), label, issuer });
}

export function generateSecret() {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function currentStep(now = Date.now()) {
  return Math.floor(now / (SETTINGS.period * 1000));
}

export function codeAt(secret: string, step: number) {
  return totp(secret).generate({ timestamp: step * SETTINGS.period * 1000 });
}

/** Returns the matching time step (±1 step of clock drift), or null. */
export function verifyCode(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const delta = totp(secret).validate({ token: code, timestamp: now, window: 1 });
  return delta === null ? null : currentStep(now) + delta;
}

export function otpauthUri(secret: string, account: string, issuer: string) {
  return totp(secret, account, issuer).toString();
}
