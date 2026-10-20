import { prisma } from "./db";
import { AppError } from "./errors";

/*
 * Simple fixed-window rate limits stored in Postgres, so they hold across server instances and restarts.
 * Each call records one hit; a per-key advisory lock stops parallel requests slipping past the count.
 * Sign-in, two-step codes and password resets have their own throttles in auth.ts and password-reset.ts.
 */

export const LIMITS = {
  register: { max: 5, minutes: 60 },
  discountCode: { max: 10, minutes: 15 },
  checkout: { max: 20, minutes: 15 },
  payoutRequest: { max: 5, minutes: 60 },
  payoutAccount: { max: 5, minutes: 60 },
  passwordChange: { max: 5, minutes: 15 },
  mfaManage: { max: 5, minutes: 15 },
  supportTicket: { max: 10, minutes: 60 },
  supportReply: { max: 30, minutes: 60 },
  export: { max: 30, minutes: 60 },
} as const;

export type LimitName = keyof typeof LIMITS;

export async function rateLimit(name: LimitName, ...ids: string[]) {
  const { max, minutes } = LIMITS[name];
  const since = new Date(Date.now() - minutes * 60e3);
  await prisma.$transaction(async (tx) => {
    for (const id of ids) {
      const key = `rl:${name}:${id}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const hits = await tx.loginAttempt.count({ where: { key, createdAt: { gte: since } } });
      if (hits >= max) throw new AppError(`Too many attempts. Please wait ${minutes >= 60 ? `${minutes / 60} hour` : `${minutes} minutes`} and try again.`, 429);
    }
    await tx.loginAttempt.createMany({ data: ids.map((id) => ({ key: `rl:${name}:${id}`, success: false })) });
  });
}
