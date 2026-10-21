/**
 * Refuses to deploy a migration that can destroy data unless someone has approved it in writing.
 * Runs before `prisma migrate deploy` (render.yaml preDeployCommand, release step 4) and in the release checks.
 *
 * A pending migration that drops, truncates, deletes, renames or changes the type of anything must contain
 * a line `-- approved-destructive: <name>, <date>, <reason>` added by the person who approved it.
 * Migrations up to BASELINE were written and reviewed before launch, when no live data existed.
 *
 *   DATABASE_URL=… npx tsx scripts/check-migrations.ts          # checks migrations not yet applied there
 *   npx tsx scripts/check-migrations.ts --all                     # checks every migration after BASELINE
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

export const BASELINE = "20261020250000_tree_path_integrity";
const DIR = join(__dirname, "..", "prisma", "migrations");

const DESTRUCTIVE: [RegExp, string][] = [
  [/\bDROP\s+(TABLE|COLUMN|SCHEMA|TYPE|INDEX|CONSTRAINT|TRIGGER|FUNCTION|VIEW)\b/i, "drops something"],
  [/\bALTER\s+TABLE\b[^;]*\bDROP\b/i, "drops part of a table"],
  [/\bTRUNCATE\b/i, "empties a table"],
  [/\bDELETE\s+FROM\b/i, "deletes rows"],
  [/\bUPDATE\s+"?\w+"?\s+SET\b/i, "rewrites rows"],
  [/\bRENAME\b/i, "renames something"],
  [/\bALTER\s+COLUMN\b[^;]*\b(TYPE|SET\s+NOT\s+NULL)\b/i, "changes a column's type or makes it required"],
];

export function problems(sql: string) {
  if (/^--\s*approved-destructive:\s*\S.{5,}/im.test(sql)) return [];
  const code = sql.replace(/--.*$/gm, "");
  return DESTRUCTIVE.filter(([re]) => re.test(code)).map(([, why]) => why);
}

async function pending(all: boolean) {
  const local = readdirSync(DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const candidates = local.filter((m) => m > BASELINE);
  if (all) return candidates;
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`.catch(() => []);
    const applied = new Set(rows.map((r) => r.migration_name));
    return candidates.filter((m) => !applied.has(m));
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const list = await pending(process.argv.includes("--all"));
  const blocked = list.map((m) => ({ m, why: problems(readFileSync(join(DIR, m, "migration.sql"), "utf8")) })).filter((x) => x.why.length);
  for (const b of blocked) console.error(`BLOCKED ${b.m}: ${b.why.join(", ")}. Needs a "-- approved-destructive: <name>, <date>, <reason>" line.`);
  console.info(`${list.length} migration(s) checked, ${blocked.length} blocked.`);
  process.exit(blocked.length ? 1 : 0);
}

if (require.main === module) main();
