import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Role, User } from "@prisma/client";
import { prisma } from "./db";
import { AppError } from "./errors";

export const SESSION_COOKIE = "nn_session";
export const SESSION_DAYS = 14;
const LOGIN_WINDOW_MIN = 15;
const LOGIN_MAX_FAILS = 5;

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}
export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

export function randomCode(len = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(len);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** Creates a session and returns the raw token (only its hash is stored). */
export async function createSession(userId: string, meta: { ip?: string; userAgent?: string } = {}) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  await prisma.session.create({ data: { tokenHash: sha256(token), userId, expiresAt, ...meta } });
  return { token, expiresAt };
}

export async function userFromToken(token: string | undefined | null) {
  if (!token) return null;
  const s = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!s || s.expiresAt < new Date() || s.user.status !== "ACTIVE") return null;
  return s.user;
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

export async function authenticate(email: string, password: string, ip = "unknown"): Promise<User> {
  const keys = [`email:${email.toLowerCase()}`, `ip:${ip}`];
  await assertLoginAllowed(keys);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  // Compare against a dummy hash when the user is missing, so timing doesn't reveal which emails exist.
  const ok = await verifyPassword(password, user?.passwordHash ?? "$2a$12$JOZMAk1LkBfk/FgNqX1WKeMEteLMYRpk8DiW.h.tLDNZAMTyWThaG");
  await prisma.loginAttempt.createMany({ data: keys.map((key) => ({ key, success: ok && !!user })) });
  if (!user || !ok) throw new AppError("Email or password is incorrect.", 401);
  if (user.status !== "ACTIVE") throw new AppError("This account is suspended.", 403);
  return user;
}

export function hasRole(user: Pick<User, "role"> | null, ...roles: Role[]) {
  return !!user && roles.includes(user.role);
}
