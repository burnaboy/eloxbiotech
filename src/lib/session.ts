import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { AdminPermission } from "@prisma/client";
import { SESSION_COOKIE, SESSION_DAYS, createSession, destroySession, sessionFromToken } from "./auth";
import { mfaRequired } from "./mfa";
import { prisma } from "./db";

/** How long a fresh authenticator code unlocks sensitive admin actions. */
export const STEP_UP_MINUTES = 10;

export async function getSession() {
  const jar = await cookies();
  return sessionFromToken(jar.get(SESSION_COOKIE)?.value);
}

export async function getCurrentUser() {
  const s = await getSession();
  return s && !s.mfaPending ? s.user : null;
}

export async function requireUser(next = "/") {
  const s = await getSession();
  if (s?.mfaPending) redirect(`/login/verify?next=${encodeURIComponent(next)}`);
  if (!s) redirect(`/login?next=${encodeURIComponent(next)}`);
  return s.user;
}

export async function requireAffiliate() {
  const user = await requireUser("/dashboard");
  if (user.role === "CUSTOMER") redirect("/dashboard/join");
  return user;
}

/** Any admin page. Admins must have two-step verification turned on before they can do anything. */
export async function requireAdmin(permission?: AdminPermission) {
  const user = await requireUser("/admin");
  if (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN") redirect("/");
  if (!user.emailVerifiedAt) redirect("/account?error=Confirm%20your%20email%20before%20using%20the%20admin%20area.");
  if (mfaRequired(user.role) && !user.mfaEnabledAt) redirect("/account/security?required=1");
  if (permission && user.role !== "SUPER_ADMIN" && !user.adminPermissions.includes(permission)) redirect("/admin?error=You%20don%27t%20have%20access%20to%20that%20area.");
  return user;
}

export function canAccess(user: { role: string; adminPermissions: AdminPermission[] }, p: AdminPermission) {
  return user.role === "SUPER_ADMIN" || (user.role === "ADMIN" && user.adminPermissions.includes(p));
}

export async function requireSuperAdmin() {
  const user = await requireAdmin();
  if (user.role !== "SUPER_ADMIN") redirect("/admin?error=Only%20a%20super%20administrator%20can%20do%20that.");
  return user;
}

/**
 * Sensitive actions need a second-factor check within the last few minutes.
 * Returns true if recent; otherwise false so callers can send the admin to /admin/verify.
 */
export async function hasRecentStepUp() {
  const s = await getSession();
  return !!s?.mfaVerifiedAt && Date.now() - s.mfaVerifiedAt.getTime() < STEP_UP_MINUTES * 60e3;
}

export async function markStepUp() {
  const jar = await cookies();
  const s = await sessionFromToken(jar.get(SESSION_COOKIE)?.value);
  if (s) await prisma.session.update({ where: { id: s.id }, data: { mfaVerifiedAt: new Date(), mfaPending: false } });
}

/**
 * The caller's IP for rate limits and audit. X-Forwarded-For can be forged by the client, so only the entry
 * added by our own proxy is trusted: TRUSTED_PROXY_HOPS proxies (default 1) append to the right of the list.
 */
export async function clientIp() {
  const h = await headers();
  const hops = Math.max(1, Number(process.env.TRUSTED_PROXY_HOPS) || 1);
  const list = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list[list.length - hops] || h.get("x-real-ip") || "unknown";
}

/** Always issues a brand-new token (and drops any existing one), so a planted cookie can't be reused: no session fixation. */
export async function startSession(userId: string, opts: { mfaPending?: boolean } = {}) {
  const h = await headers();
  const old = (await cookies()).get(SESSION_COOKIE)?.value;
  if (old) await destroySession(old);
  const { token, expiresAt } = await createSession(userId, {
    ip: await clientIp(),
    userAgent: h.get("user-agent")?.slice(0, 255) ?? undefined,
    mfaPending: opts.mfaPending ?? false,
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function endSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  jar.delete(SESSION_COOKIE);
}

/** Cost prices and margins: super admins, and admins given PRODUCT_COSTS. */
export function canSeeCosts(user: { role: string; adminPermissions: AdminPermission[] }) {
  return canAccess(user, "PRODUCT_COSTS");
}
