"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { runAction, str, type ActionState } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { SESSION_COOKIE, hashPassword, sha256, verifyPassword } from "@/lib/auth";
import { registerSchema } from "@/lib/users";
import { saveAddress, deleteAddress, addressInput } from "@/lib/addresses";
import { beginEnrolment, checkSecondFactor, confirmEnrolment, mfaRequired } from "@/lib/mfa";
import { audit } from "@/lib/audit";
import { sendVerificationEmail } from "@/lib/email-verification";

export async function updateProfileAction(fd: FormData) {
  const user = await requireUser("/account");
  const res = await runAction(async () => {
    const v = z.object({ name: z.string().trim().min(2).max(80), phone: z.string().trim().max(30) }).parse({ name: str(fd, "name"), phone: str(fd, "phone") });
    await prisma.user.update({ where: { id: user.id }, data: { name: v.name, phone: v.phone || null } });
    return { ok: "Profile saved" };
  });
  redirect(`/account?${res?.error ? `error=${encodeURIComponent(res.error)}` : "ok=Profile%20saved"}`);
}

export async function changePasswordAction(fd: FormData) {
  const user = await requireUser("/account");
  const res = await runAction(async () => {
    const next = registerSchema.shape.password.parse(str(fd, "newPassword"));
    if (next !== str(fd, "confirm")) throw new AppError("New passwords don't match.");
    if (!(await verifyPassword(str(fd, "current"), user.passwordHash))) throw new AppError("Current password is incorrect.");
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
    // Sign out every other device.
    const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
    await prisma.session.deleteMany({ where: { userId: user.id, NOT: { tokenHash: sha256(token) } } });
    await audit("user.passwordChange", "User", user.id, user.id);
  });
  redirect(`/account?${res?.error ? `error=${encodeURIComponent(res.error)}` : "ok=Password%20changed.%20Other%20devices%20were%20signed%20out."}`);
}

export async function saveAddressAction(id: string | null, raw: z.input<typeof addressInput>): Promise<ActionState> {
  const user = await requireUser("/account/addresses");
  return runAction(async () => {
    await saveAddress(user.id, id, raw);
    revalidatePath("/account/addresses");
    return { ok: "Address saved" };
  });
}

export async function deleteAddressAction(id: string) {
  const user = await requireUser("/account/addresses");
  await deleteAddress(user.id, id);
  revalidatePath("/account/addresses");
}

export async function startMfaAction() {
  const user = await requireUser("/account/security");
  if (user.mfaEnabledAt) redirect("/account/security");
  await beginEnrolment(user.id);
  redirect("/account/security?setup=1");
}

export async function confirmMfaAction(code: string): Promise<ActionState & { recovery?: string[] }> {
  const user = await requireUser("/account/security");
  let recovery: string[] = [];
  const res = await runAction(async () => {
    recovery = await confirmEnrolment(user.id, code);
  });
  return res ?? { ok: "Two-step verification is on.", recovery };
}

export async function disableMfaAction(fd: FormData) {
  const user = await requireUser("/account/security");
  const res = await runAction(async () => {
    if (mfaRequired(user.role)) throw new AppError("Two-step verification is required for administrators.");
    if (!(await checkSecondFactor(user.id, str(fd, "code")))) throw new AppError("That code isn't valid.");
    await prisma.user.update({ where: { id: user.id }, data: { mfaSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryHashes: [] } });
    await audit("mfa.disable", "User", user.id, user.id);
  });
  redirect(`/account/security?${res?.error ? `error=${encodeURIComponent(res.error)}` : "ok=Two-step%20verification%20turned%20off"}`);
}

export async function resendVerificationAction() {
  const user = await requireUser("/account");
  const res = await runAction(() => sendVerificationEmail(user.id));
  redirect(`/account?${res?.error ? `error=${encodeURIComponent(res.error)}` : "ok=Verification%20email%20sent."}`);
}

export async function savePrefsAction(fd: FormData) {
  const user = await requireUser("/account");
  await prisma.user.update({
    where: { id: user.id },
    data: { emailOrderUpdates: fd.get("emailOrderUpdates") === "on", emailCommissionUpdates: fd.get("emailCommissionUpdates") === "on", emailMarketing: fd.get("emailMarketing") === "on" },
  });
  redirect("/account?ok=Email%20preferences%20saved");
}
