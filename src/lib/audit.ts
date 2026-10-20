import type { Prisma } from "@prisma/client";
import type { Tx } from "./db";
import { prisma } from "./db";

export async function audit(
  action: string,
  entity: string,
  entityId: string | null,
  actorId: string | null,
  data?: Prisma.InputJsonValue,
  tx: Tx = prisma,
) {
  await tx.auditLog.create({ data: { action, entity, entityId, actorId, data } });
}
