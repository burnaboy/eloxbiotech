import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import type { Role, User } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";

export const SESSION_COOKIE = "nn_session";
export const SESSION_DAYS = 14;
const LOGIN_WINDOW_MIN = 15;
const LOGIN_MAX_FAILS = 5;

/** Argon2id with OWASP-recommended parameters. Older bcrypt hashes still verify and are upgraded at next sign-in. */
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export async function hashPassword(pw: string) {
  return argonHash(pw, ARGON);
}
export async function verifyPassword(pw: string, hash: string) {
  if (hash.startsWith("$2")) return bcrypt.compare(pw, hash);
  try {
    return await argonVerify(hash, pw);
  } catch {
    return false;
  }
}
export function needsRehash(hash: string) {
  return !hash.startsWith("$argon2id$");
}

/** Absolute session lifetimes and idle timeouts. Admin sessions are much shorter. */
export const SESSION_POLICY = {
  member: { absoluteMs: SESSION_DAYS * 864e5, idleMs: 7 * 864e5 },
  admin: { absoluteMs: 12 * 3600e3, idleMs: 2 * 3600e3 },
};

export function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

export function randomCode(len = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(len);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Creates a session and returns the raw token (only its hash is stored). */
export async function createSession(userId: string, meta: { ip?: string; userAgent?: string; mfaPending?: boolean } = {}) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await prisma.session.create({ data: { tokenHash: sha256(token), userId, expiresAt, ...meta } });
  return { token, expiresAt };
}

/** Returns the session (with user) for a token, including sessions still waiting for the second factor. */
export async function sessionFromToken(token: string | undefined | null) {
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!s || s.expiresAt < new Date() || s.user.status !== "ACTIVE") return null;
  const policy = isAdmin(s.user) ? SESSION_POLICY.admin : SESSION_POLICY.member;
  const now = Date.now();
  if (now - s.createdAt.getTime() > policy.absoluteMs || now - s.lastSeenAt.getTime() > policy.idleMs) {
    await prisma.session.delete({ where: { id: s.id } }).catch(() => {});
    return null;
  }
  // Refresh "last seen" at most every 5 minutes to keep writes low.
  if (now - s.lastSeenAt.getTime() > 5 * 60e3) await prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  return s;
}

/** A fully signed-in user (second factor done if the account has one). */
export async function userFromToken(token: string | undefined | null) {
  const s = await sessionFromToken(token);
  return s && !s.mfaPending ? s.user : null;
}

export async function destroySession(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

/** Throttles repeated failed sign-ins per email and per IP. */
export async function assertLoginAllowed(keys: string[]) {
  const since = new Date(Date.now() - LOGIN_WINDOW_MIN * 60e3);
  for (const key of keys) {
    const fails = await prisma.loginAttempt.count({ where: { key, success: false, createdAt: { gte: since } } });
    if (fails >= LOGIN_MAX_FAILS) throw new AppError("Too many failed attempts. Try again in 15 minutes.", 429);
  }
}

// Used when the email doesn't exist, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = "$argon2id$v=19$m=19456,t=2,p=1$TA0On8X9NUS9S7mHHCmJog$xYx036iY08jGQI9B0RWUgP/P/z7XnO7jvxObdVuS4Zw";

export async function authenticate(email: string, password: string, ip = "unknown"): Promise<User> {
  const keys = [`email:${email.toLowerCase()}`, `ip:${ip}`];
  await assertLoginAllowed(keys);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  // Compare against a dummy hash when the user is missing, so timing doesn't reveal which emails exist.
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  await prisma.loginAttempt.createMany({ data: keys.map((key) => ({ key, success: ok && !!user })) });
  if (!user || !ok) throw new AppError("Email or password is incorrect.", 401);
  if (user.status !== "ACTIVE") throw new AppError("This account is suspended. Please contact support.", 403);
  if (needsRehash(user.passwordHash)) {
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
  }
  return user;
}

export function hasRole(user: Pick<User, "role"> | null, ...roles: Role[]) {
  return !!user && roles.includes(user.role);
}

export function isAdmin(user: Pick<User, "role"> | null) {
  return hasRole(user, "ADMIN", "SUPER_ADMIN");
}
