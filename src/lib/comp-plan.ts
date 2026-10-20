import type { CompPlanVersion, Prisma } from "@prisma/client";
import { prisma, type Tx } from "./db";
import { compPlanSchema, getCompPlan, parseCompPlan, saveSetting, type CompPlan } from "./settings";
import { audit } from "./audit";

/*
 * Compensation plan versions. Saving the plan writes a new CompPlanVersion row (rows can't be edited or
 * deleted: a database trigger refuses it). An order records the version in force when it was paid, and
 * every commission on it is calculated, re-calculated after a partial refund, or audited with that version.
 */

const LOCK = 7_310_002;

/** The version currently in force. Creates version 1 from the stored settings the first time. */
export async function currentPlanVersion(tx: Tx = prisma): Promise<CompPlanVersion> {
  const latest = await tx.compPlanVersion.findFirst({ orderBy: { version: "desc" } });
  if (latest) return latest;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK})`;
  const again = await tx.compPlanVersion.findFirst({ orderBy: { version: "desc" } });
  if (again) return again;
  const rules = await getCompPlan(tx);
  return tx.compPlanVersion.create({ data: { version: 1, rules: rules as unknown as Prisma.InputJsonObject, note: "Initial plan" } });
}

export function rulesOf(v: Pick<CompPlanVersion, "rules">): CompPlan {
  return parseCompPlan(v.rules);
}

/** The rules an order's commissions must use: its own version, or the current one for orders from before versioning. */
export async function planForOrder(tx: Tx, order: { planVersionId: string | null }) {
  const v = order.planVersionId ? await tx.compPlanVersion.findUniqueOrThrow({ where: { id: order.planVersionId } }) : await currentPlanVersion(tx);
  return { version: v, rules: rulesOf(v) };
}

/** Saves a new plan: validates it, stores it as the current settings, and records it as the next version. */
export async function publishPlan(raw: unknown, actorId: string | null, note: string) {
  const rules = compPlanSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK})`;
    const prev = await currentPlanVersion(tx);
    const v = await tx.compPlanVersion.create({
      data: { version: prev.version + 1, rules: rules as unknown as Prisma.InputJsonObject, note: note.trim().slice(0, 300) || null, createdById: actorId },
    });
    await saveSetting("compPlan", rules, tx);
    await audit("settings.compPlan", "CompPlanVersion", v.id, actorId, { version: v.version, before: prev.rules, after: rules as unknown as Prisma.InputJsonObject, privileged: true } as Prisma.InputJsonObject, tx);
    return v;
  });
}
