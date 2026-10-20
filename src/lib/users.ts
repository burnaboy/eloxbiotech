import { Prisma, type Leg } from "@prisma/client";
import { z } from "zod";
import { hashPassword, randomCode } from "./auth";
import { prisma, type Tx } from "./db";
import { getCompPlan } from "./settings";
import { AppError } from "./errors";
import { placeInTree } from "./tree";
import { audit } from "./audit";

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(160),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
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
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const target = String(e.meta?.target ?? "");
        if (target.includes("email")) throw new AppError("An account with this email already exists.");
        if (target.includes("referralCode")) continue;
      }
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
