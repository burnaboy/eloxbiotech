import { createHash } from "node:crypto";
import type { AuditLog, Prisma } from "@prisma/client";
import type { Tx } from "./db";
import { prisma } from "./db";

/*
 * Audit trail. Rows are written inside the transaction that made the change, so a change and its record
 * commit together. The database refuses to delete or edit them (trigger "audit_log_append_only").
 *
 * Tamper evidence: `sealAuditLog` (cron, and before every check) links committed rows into a hash chain.
 * Each sealed row stores sha256(previous hash + its own content). Editing or removing a sealed row, even
 * with direct database access, breaks the chain from that point and `verifyAuditChain` reports where.
 * To also catch someone rewriting the whole chain, keep a copy of the latest hash outside the database
 * (it is shown on Admin > Audit log).
 */

export async function audit(
  action: string,
  entity: string,
  entityId: string | null,
  actorId: string | null,
  data?: Prisma.InputJsonValue,
  tx: Tx = prisma,
) {
  return tx.auditLog.create({ data: { action, entity, entityId, actorId, data } });
}

/** JSON with object keys sorted, so the same content always hashes the same way. */
export function canonicalJson(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

type Hashable = Pick<AuditLog, "id" | "actorId" | "action" | "entity" | "entityId" | "data" | "createdAt">;

export function auditHash(prevHash: string, row: Hashable) {
  const content = canonicalJson({
    id: row.id,
    actorId: row.actorId,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    data: row.data,
    createdAt: row.createdAt.toISOString(),
  });
  return createHash("sha256").update(`${prevHash}\n${content}`).digest("hex");
}

const GENESIS = "0".repeat(64);
const SEAL_LOCK = 7_310_003;

/**
 * Links committed, unsealed rows onto the end of the chain, oldest first. Only one sealer runs at a time.
 * Rows from transactions still in progress are invisible here and get sealed on a later run.
 */
export async function sealAuditLog(batch = 1000) {
  let sealed = 0;
  for (;;) {
    const n = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SEAL_LOCK})`;
      const last = await tx.auditLog.findFirst({ where: { chainPos: { not: null } }, orderBy: { chainPos: "desc" } });
      const rows = await tx.auditLog.findMany({ where: { hash: null }, orderBy: { seq: "asc" }, take: batch });
      let prev = last?.hash ?? GENESIS;
      let pos = last?.chainPos ?? 0;
      for (const r of rows) {
        pos += 1;
        const hash = auditHash(prev, r);
        await tx.auditLog.update({ where: { id: r.id }, data: { chainPos: pos, prevHash: prev, hash } });
        prev = hash;
      }
      return rows.length;
    }, { timeout: 60_000 });
    sealed += n;
    if (n < batch) return sealed;
  }
}

export interface ChainCheck {
  ok: boolean;
  checked: number;
  unsealed: number;
  latestHash: string | null;
  latestPos: number;
  /** First row where the chain doesn't add up. */
  brokenAt?: { chainPos: number; id: string; problem: string };
}

/** Recomputes the whole chain. Any edited, removed or reordered sealed row shows up as a break. */
export async function verifyAuditChain(): Promise<ChainCheck> {
  await sealAuditLog();
  let prev = GENESIS;
  let expected = 1;
  let checked = 0;
  let cursor = 0;
  for (;;) {
    const rows = await prisma.auditLog.findMany({ where: { chainPos: { gt: cursor } }, orderBy: { chainPos: "asc" }, take: 2000 });
    if (!rows.length) break;
    for (const r of rows) {
      const fail = (problem: string) => ({ ok: false, checked, unsealed: 0, latestHash: null, latestPos: cursor, brokenAt: { chainPos: r.chainPos!, id: r.id, problem } });
      if (r.chainPos !== expected) return fail(`Row ${expected} is missing`);
      if (r.prevHash !== prev) return fail("Link to the previous row doesn't match");
      if (r.hash !== auditHash(prev, r)) return fail("Row content was changed after it was recorded");
      prev = r.hash!;
      expected++;
      checked++;
      cursor = r.chainPos!;
    }
  }
  const unsealed = await prisma.auditLog.count({ where: { hash: null } });
  return { ok: true, checked, unsealed, latestHash: checked ? prev : null, latestPos: cursor };
}
