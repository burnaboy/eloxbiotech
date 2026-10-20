import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import { AppError } from "./errors";
import { assertLoginAllowed, hashPassword, sha256 } from "./auth";
import { registerSchema } from "./users";
import { sendEmail } from "./email";
import { audit } from "./audit";
import { getBrand } from "./settings";

const TTL_MIN = 30;

/** Always behaves the same whether or not the email exists, so it can't be used to discover accounts. */
export async function requestPasswordReset(emailRaw: string, ip: string) {
  const email = emailRaw.trim().toLowerCase();
  const keys = [`reset:${email}`, `reset-ip:${ip}`];
  await assertLoginAllowed(keys);
  await prisma.loginAttempt.createMany({ data: keys.map((key) => ({ key, success: false })) });
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE") return;
  const token = randomBytes(32).toString("base64url");
  await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL_MIN * 60e3) } });
  const brand = await getBrand();
  const link = `${process.env.APP_URL}/reset-password/${token}`;
  await sendEmail(
    user.email,
    `Reset your ${brand.companyName} password`,
    `Hello ${user.name},\n\nUse this link to choose a new password. It expires in ${TTL_MIN} minutes and works once:\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
  );
}

export async function resetPassword(token: string, newPassword: string) {
  const pw = registerSchema.shape.password.parse(newPassword);
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw new AppError("This reset link is invalid or has expired. Please request a new one.");
  const claimed = await prisma.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count === 0) throw new AppError("This reset link has already been used.");
  await prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(pw) } });
  await prisma.session.deleteMany({ where: { userId: row.userId } });
  await prisma.passwordResetToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: new Date() } });
  await audit("user.passwordReset", "User", row.userId, row.userId);
}
