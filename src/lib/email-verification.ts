import { randomBytes } from "node:crypto";
import { prisma } from "./db";
import { AppError } from "./errors";
import { sha256 } from "./auth";
import { sendEmail } from "./email";
import { getBrand } from "./settings";
import { audit } from "./audit";

const TTL_HOURS = 24;

export async function sendVerificationEmail(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.emailVerifiedAt) return;
  const recent = await prisma.emailVerificationToken.count({ where: { userId, createdAt: { gte: new Date(Date.now() - 3600e3) } } });
  if (recent >= 5) throw new AppError("Too many verification emails. Please wait an hour.");
  const token = randomBytes(32).toString("base64url");
  await prisma.emailVerificationToken.create({ data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL_HOURS * 3600e3) } });
  const brand = await getBrand();
  await sendEmail(
    user.email,
    `Confirm your email for ${brand.companyName}`,
    `Hello ${user.name},\n\nPlease confirm your email address:\n${process.env.APP_URL}/verify-email/${token}\n\nThe link expires in ${TTL_HOURS} hours.`,
  );
}

export async function verifyEmail(token: string) {
  const row = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw new AppError("This link is invalid or has expired. Request a new one from your account.");
  await prisma.$transaction([
    prisma.emailVerificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } }),
  ]);
  await audit("user.emailVerified", "User", row.userId, row.userId);
  return row.userId;
}

export function requireVerified(user: { emailVerifiedAt: Date | null }, what: string) {
  if (!user.emailVerifiedAt) throw new AppError(`Please confirm your email address before ${what}. Check your inbox, or resend the link from your account page.`, 403);
}
