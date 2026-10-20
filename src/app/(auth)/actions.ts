"use server";

import { rateLimit } from "@/lib/rate-limit";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertLoginAllowed, authenticate } from "@/lib/auth";
import { clientIp, endSession, getSession, markStepUp, startSession } from "@/lib/session";
import { checkSecondFactor } from "@/lib/mfa";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requestPasswordReset, resetPassword } from "@/lib/password-reset";
import { sendVerificationEmail } from "@/lib/email-verification";
import { registerUser, type RegisterInput } from "@/lib/users";
import { runAction, type ActionState } from "@/lib/action";
import { logError } from "@/lib/log";

function safeNext(next: unknown) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1).max(200), next: z.string().optional() });

export async function loginAction(input: z.input<typeof loginSchema>): Promise<ActionState> {
  let dest = "/";
  const res = await runAction(async () => {
    const v = loginSchema.parse(input);
    const user = await authenticate(v.email, v.password, await clientIp());
    const needsCode = !!user.mfaEnabledAt;
    await startSession(user.id, { mfaPending: needsCode });
    dest = needsCode ? `/login/verify?next=${encodeURIComponent(safeNext(v.next))}` : safeNext(v.next);
  });
  if (res) return res;
  redirect(dest);
}

/** Second step of sign-in, and the "confirm it's you" step before sensitive admin actions. */
export async function verifyCodeAction(input: { code: string; next?: string }): Promise<ActionState> {
  let dest = "/";
  const res = await runAction(async () => {
    const s = await getSession();
    if (!s) throw new AppError("Your sign-in expired. Please sign in again.");
    const key = `mfa:${s.userId}`;
    await assertLoginAllowed([key]);
    const ok = await checkSecondFactor(s.userId, z.string().max(40).parse(input.code));
    await prisma.loginAttempt.create({ data: { key, success: ok } });
    if (!ok) throw new AppError("That code isn't valid. Try the newest code from your app.");
    await markStepUp();
    dest = safeNext(input.next);
  });
  if (res) return res;
  redirect(dest);
}

export async function registerAction(input: RegisterInput): Promise<ActionState> {
  const res = await runAction(async () => {
    const ip = await clientIp();
    await rateLimit("register", ip);
    const user = await registerUser(input, { ip });
    await startSession(user.id);
    await sendVerificationEmail(user.id).catch((e) => logError("verification email", e));
    (await cookies()).delete("ref");
  });
  if (res) return res;
  redirect("/account?welcome=1");
}

export async function logoutAction() {
  await endSession();
  redirect("/");
}

export async function forgotPasswordAction(input: { email: string }): Promise<ActionState> {
  return runAction(async () => {
    const email = z.string().trim().email().parse(input.email);
    await requestPasswordReset(email, await clientIp());
    return { ok: "If an account exists for that email, we've sent a reset link. It expires in 30 minutes." };
  });
}

export async function resetPasswordAction(input: { token: string; password: string }): Promise<ActionState> {
  const res = await runAction(() => resetPassword(input.token, input.password));
  if (res) return res;
  redirect("/login?reset=1");
}
