import { Prisma, type Leg } from "@prisma/client";
import { z } from "zod";
import { hashPassword, randomCode } from "./auth";
import { prisma, type Tx } from "./db";
import { getCompPlan } from "./settings";
import { AppError } from "./errors";
import { placeInTree } from "./tree";
import { audit } from "./audit";

/** Optional phone: if given it must hold 7 to 15 digits, so "+234 803 123 4567" and "08031234567" both pass. */
export const phoneField = z
  .string()
  .trim()
  .max(30)
  .refine((v) => v === "" || /^\+?[\d\s().-]+$/.test(v), "Enter a phone number using digits only")
  .refine((v) => { const d = v.replace(/\D/g, "").length; return v === "" || (d >= 7 && d <= 15); }, "Enter a full phone number, for example 0803 123 4567")
  .optional()
  .or(z.literal(""));

export const DUPLICATE_EMAIL = "An account with this email address already exists. Sign in instead, or use “Forgot password” if you can't get in.";
export const DUPLICATE_PHONE = "This phone number is already linked to another account. Sign in to that account instead, or contact support if the number is yours.";

/**
 * Says whether the email or phone already belongs to an account, using the same rules as the database
 * (so "j.ohn+2@gmail.com" matches "john@gmail.com", and "0803…" matches "+234803…").
 * This gives a clear message early; the unique indexes still catch two sign-ups at the same moment.
 */
export async function findDuplicate(email: string, phone: string | null | undefined, exceptUserId?: string) {
  const rows = await prisma.$queryRaw<{ email: boolean; phone: boolean }[]>`
    SELECT "emailCanonical" = canonical_email(${email}) AS email,
           COALESCE("phoneNormalized" = normalize_phone(${phone || null}::text), false) AS phone
    FROM "User"
    WHERE ("emailCanonical" = canonical_email(${email}) OR "phoneNormalized" = normalize_phone(${phone || null}::text))
      AND id <> ${exceptUserId ?? ""}
    LIMIT 2`;
  if (rows.some((r) => r.email)) return DUPLICATE_EMAIL;
  if (rows.some((r) => r.phone)) return DUPLICATE_PHONE;
  return null;
}

/** Turns a unique-index clash on email or phone into a message for the form, or null for anything else. */
export function duplicateMessage(e: unknown) {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return null;
  const target = String(e.meta?.target ?? "");
  if (target.includes("phone")) return DUPLICATE_PHONE;
  if (target.includes("email")) return DUPLICATE_EMAIL;
  return null;
}

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(160),
  phone: phoneField,
  password: z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(200)
    .regex(/[A-Za-z]/, "Password needs a letter")
    .regex(/[0-9]/, "Password needs a number"),
  referralCode: z.string().trim().toUpperCase().max(20).optional().or(z.literal("")),
  leg: z.enum(["LEFT", "RIGHT"]).optional().nullable(),
  joinAsAffiliate: z.boolean().default(false),
});
export type RegisterInput = z.input<typeof registerSchema>;

async function findSponsor(code: string | undefined) {
  if (!code) return null;
  const sponsor = await prisma.user.findUnique({ where: { referralCode: code }, include: { node: true } });
  if (!sponsor || sponsor.status !== "ACTIVE" || !sponsor.node) throw new AppError("That referral code is not valid.");
  return sponsor;
}

export async function registerUser(raw: RegisterInput, meta: { ip?: string } = {}) {
  const input = registerSchema.parse(raw);
  if (meta.ip) {
    const recent = await prisma.user.count({ where: { signupIp: meta.ip, createdAt: { gte: new Date(Date.now() - 3600e3) } } });
    if (recent >= 5) throw new AppError("Too many sign-ups from this network. Please try again later.", 429);
  }
  const duplicate = await findDuplicate(input.email, input.phone);
  if (duplicate) throw new AppError(duplicate, 409);
  const sponsor = await findSponsor(input.referralCode || undefined);
  const passwordHash = await hashPassword(input.password);

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: input.name,
            email: input.email,
            phone: input.phone || null,
            passwordHash,
            referralCode: randomCode(8),
            sponsorId: sponsor?.id ?? null,
            signupIp: meta.ip ?? null,
            role: input.joinAsAffiliate ? "AFFILIATE" : "CUSTOMER",
          },
        });
        if (input.joinAsAffiliate) await placeOrQueue(tx, user.id, sponsor?.id ?? null, input.leg ?? null);
        await audit("user.register", "User", user.id, user.id, { sponsorId: sponsor?.id ?? null, affiliate: input.joinAsAffiliate }, tx);
        return user;
      });
    } catch (e) {
      const duplicate = duplicateMessage(e);
      if (duplicate) throw new AppError(duplicate, 409);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && String(e.meta?.target ?? "").includes("referralCode")) continue;
      throw e;
    }
  }
  throw new AppError("Could not create the account. Please try again.");
}

/** Places immediately, or queues for an administrator when the plan uses approval placement. */
async function placeOrQueue(tx: Tx, userId: string, sponsorId: string | null, leg: Leg | null) {
  const plan = await getCompPlan(tx);
  if (plan.placementMode === "ADMIN_APPROVAL" && (await tx.affiliateNode.count()) > 0) {
    await tx.user.update({ where: { id: userId }, data: { placementPending: true, requestedLeg: leg } });
    return null;
  }
  return placeInTree(tx, userId, sponsorId, leg);
}

/** Turns a customer into an affiliate and places them under their existing sponsor. */
export async function becomeAffiliate(userId: string, leg?: Leg | null) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role !== "CUSTOMER") throw new AppError("You are already an affiliate.");
    await tx.user.update({ where: { id: userId }, data: { role: "AFFILIATE" } });
    const node = await placeOrQueue(tx, user.id, user.sponsorId, leg ?? null);
    await audit("user.becomeAffiliate", "User", userId, userId, { nodeId: node?.id ?? null, pending: !node }, tx);
    return node;
  });
}
