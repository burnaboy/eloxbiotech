/**
 * Checks a restored database before it's put into service (docs/INCIDENT-RESPONSE.md, step 4).
 * Usage: DATABASE_URL=<restored database> npx tsx scripts/verify-restore.ts
 * Prints the checks as JSON and exits non-zero if any fails. Read-only apart from sealing
 * audit records that weren't sealed when the backup was taken.
 */
import { prisma } from "../src/lib/db";
import { verifyAuditChain } from "../src/lib/audit";
import { reconcileLedger } from "../src/lib/ledger";
import { reconcileVolume } from "../src/lib/volume";

async function main() {
  const tables = await prisma.$queryRaw<{ table: string }[]>`
    SELECT tablename AS "table" FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename`;
  const counts: Record<string, number> = {};
  for (const { table } of tables) {
    const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}"`);
    counts[table] = Number(n);
  }
  const migrations = await prisma.$queryRaw<{ n: bigint; failed: bigint }[]>`
    SELECT count(*) AS n, count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS failed FROM "_prisma_migrations"`;
  const audit = await verifyAuditChain();
  const ledger = await reconcileLedger();
  const volume = await reconcileVolume();
  const checks = {
    migrationsApplied: Number(migrations[0].n),
    migrationsFailed: Number(migrations[0].failed),
    auditChain: { ok: audit.ok, checked: audit.checked, latestPos: audit.latestPos, brokenAt: audit.brokenAt ?? null },
    walletLedger: { ok: ledger.ok, members: ledger.members, problems: ledger.problems.length },
    networkVolume: { ok: volume.issueCount === 0, issues: volume.issueCount },
  };
  console.log(JSON.stringify({ counts, checks }, null, 2));
  const ok = checks.migrationsFailed === 0 && audit.ok && ledger.ok && volume.issueCount === 0;
  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(2);
});
