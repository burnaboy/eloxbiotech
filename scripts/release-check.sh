#!/usr/bin/env bash
# Release checks for the operations acceptance criteria (docs/ACCEPTANCE.md).
# Needs a local PostgreSQL 16 where $PGADMIN_URL's role can create databases, plus the
# Playwright Chromium. Writes its evidence to .release-check/ and exits non-zero on any failure.
#
#   PGADMIN_URL=postgresql://mlm:mlm@localhost:5432 scripts/release-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PG="${PGADMIN_URL:-postgresql://mlm:mlm@localhost:5432}"
OUT=.release-check
rm -rf "$OUT" && mkdir -p "$OUT"
step() { printf '\n== %s\n' "$*"; }
fail() { echo "FAILED: $*" >&2; exit 1; }
db() { echo "$PG/$1?schema=public"; }
fresh() { psql "$PG/postgres" -qc "DROP DATABASE IF EXISTS $1 WITH (FORCE)" -c "CREATE DATABASE $1" >/dev/null; }

# Throwaway values: if any of them shows up in a browser file or a log, the check fails.
CANARY_PAYSTACK="sk_test_CANARY$(openssl rand -hex 12)"
CANARY_S3="CANARYS3$(openssl rand -hex 12)"
ENC_KEY="${APP_ENCRYPTION_KEY:-MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=}"

step "1. Types and unit/integration tests"
npx tsc --noEmit
npx vitest run 2>&1 | tee "$OUT/vitest.txt" | tail -5
grep -Eq "Tests +[0-9]+ passed" "$OUT/vitest.txt" && ! grep -Eq "[0-9]+ failed" "$OUT/vitest.txt" || fail "unit/integration tests"

step "2. Migrations are safe and reproducible"
npx tsx scripts/check-migrations.ts --all || fail "a destructive migration hasn't been approved"
fresh mlm_repro_a; fresh mlm_repro_b
DATABASE_URL=$(db mlm_repro_a) npx prisma migrate deploy >/dev/null
DATABASE_URL=$(db mlm_repro_b) npx prisma migrate deploy >/dev/null
DATABASE_URL=$(db mlm_repro_a) npx prisma migrate status | tee "$OUT/migrate-status.txt" | tail -1
grep -q "Database schema is up to date" "$OUT/migrate-status.txt" || fail "migrate status"
# The schema file and the migrations describe the same database. (CHECK constraints, triggers and
# partial indexes are written only in migrations, which Prisma doesn't model; it ignores them here.)
npx prisma migrate diff --from-url "$(db mlm_repro_a)" --to-schema-datamodel prisma/schema.prisma --script > "$OUT/schema-drift.sql"
grep -vqE '^(--|$)' "$OUT/schema-drift.sql" && { cat "$OUT/schema-drift.sql"; fail "schema.prisma and migrations differ"; }
# Two clean builds of the database are identical, constraints and triggers included.
dump() { pg_dump --schema-only --no-owner --no-privileges "$PG/$1" | grep -vE '^(--|SET |SELECT pg_catalog|\\(un)?restrict)' ; }
dump mlm_repro_a > "$OUT/schema-a.sql"; dump mlm_repro_b > "$OUT/schema-b.sql"
diff -q "$OUT/schema-a.sql" "$OUT/schema-b.sql" >/dev/null || fail "two fresh migrations differ"
echo "fresh database: $(grep -c 'CREATE TABLE' "$OUT/schema-a.sql") tables, $(grep -c 'CREATE TRIGGER' "$OUT/schema-a.sql") triggers, $(grep -c 'CHECK (' "$OUT/schema-a.sql") checks; identical twice"

step "3. Production build, then scan browser files for secrets"
PAYSTACK_SECRET_KEY="$CANARY_PAYSTACK" S3_SECRET_ACCESS_KEY="$CANARY_S3" npm run build > "$OUT/build.txt" 2>&1 || { tail -30 "$OUT/build.txt"; fail "build"; }
tail -3 "$OUT/build.txt"
BROWSER_FILES=".next/static"
PATTERNS="$CANARY_PAYSTACK|$CANARY_S3|sk_live_|sk_test_[A-Za-z0-9]{8,}|postgres(ql)?://|PRIVATE KEY|APP_ENCRYPTION_KEY|CRON_SECRET|TEST_PAYMENT_SECRET|S3_SECRET_ACCESS_KEY|PAYSTACK_SECRET_KEY|DATABASE_URL|costPriceMinor|passwordHash|mfaSecretEnc|accountNumberEnc"
if grep -rEl "$PATTERNS" "$BROWSER_FILES" > "$OUT/secret-hits.txt"; then cat "$OUT/secret-hits.txt"; fail "secret or server-only field in browser files"; fi
echo "scanned $(find "$BROWSER_FILES" -type f | wc -l) browser files: no secrets or server-only fields"

step "4. Browser tests against the production build, with the server log captured"
fresh mlm_e2e
E2E_ENV=(DATABASE_URL="$(db mlm_e2e)" APP_URL=http://localhost:3100 PAYMENT_PROVIDER=test ALLOW_TEST_PAYMENTS=true
  TEST_PAYMENT_SECRET=e2e-secret CRON_SECRET=e2e-cron MONITOR_TOKEN=e2e-monitor STORAGE_DRIVER=local ALLOW_LOCAL_STORAGE=true UPLOAD_DIR=.data/e2e-uploads
  APP_ENCRYPTION_KEY="$ENC_KEY" PAYSTACK_SECRET_KEY="$CANARY_PAYSTACK" S3_SECRET_ACCESS_KEY="$CANARY_S3")
DATABASE_URL="$(db mlm_e2e)" npx prisma migrate deploy >/dev/null
env "${E2E_ENV[@]}" node_modules/.bin/next start -p 3100 > "$OUT/server.log" 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
for _ in $(seq 60); do curl -sf http://localhost:3100/api/health >/dev/null && break; sleep 1; done
env "${E2E_ENV[@]}" CI= npx playwright test 2>&1 | tee "$OUT/playwright.txt" | grep -E "✓|✘|passed|failed" || true
grep -Eq "[0-9]+ passed" "$OUT/playwright.txt" && ! grep -Eq "[0-9]+ failed" "$OUT/playwright.txt" || fail "browser tests"
kill $SERVER; wait $SERVER 2>/dev/null || true

step "5. Logs don't expose credentials"
# Passwords used by the browser tests, the secrets the server ran with, and live session tokens.
SESSIONS=$(psql "$PG/mlm_e2e" -Atc 'SELECT string_agg("id", $$|$$) FROM "Session"' || true)
LOG_PATTERNS="Password123|AdminPass123|buyerpass123|e2e-secret|e2e-cron|e2e-monitor|$CANARY_PAYSTACK|$CANARY_S3|mlm:mlm@|Bearer |sk_live_|$(printf %s "$ENC_KEY" | sed 's/[+/=]/./g')${SESSIONS:+|$SESSIONS}"
if grep -Eq "$LOG_PATTERNS" "$OUT/server.log"; then grep -En "$LOG_PATTERNS" "$OUT/server.log" | head; fail "credential in server log"; fi
echo "server log: $(wc -l < "$OUT/server.log") lines, no passwords, secrets, keys or session tokens"

step "6. Backup and restore"
psql "$PG/mlm_e2e" -Atc 'SELECT count(*) FROM "Order"' | xargs echo "orders in source:"
START=$(date +%s)
pg_dump --format=custom --no-owner --file="$OUT/backup.dump" "$PG/mlm_e2e"
fresh mlm_restore
pg_restore --no-owner --exit-on-error --dbname="$PG/mlm_restore" "$OUT/backup.dump"
echo "dump and restore took $(( $(date +%s) - START ))s, $(du -h "$OUT/backup.dump" | cut -f1)"
DATABASE_URL=$(db mlm_e2e) npx tsx scripts/verify-restore.ts > "$OUT/source-checks.json" || fail "source database checks"
DATABASE_URL=$(db mlm_restore) npx tsx scripts/verify-restore.ts > "$OUT/restore-checks.json" || { cat "$OUT/restore-checks.json"; fail "restored database checks"; }
python3 - "$OUT/source-checks.json" "$OUT/restore-checks.json" <<'PY' || fail "restored data differs from source"
import json, sys
a, b = (json.load(open(p)) for p in sys.argv[1:])
assert a["counts"] == b["counts"], "row counts differ"
assert a["checks"]["auditChain"]["latestPos"] == b["checks"]["auditChain"]["latestPos"], "audit chain length differs"
print(f'restored {sum(b["counts"].values())} rows in {len(b["counts"])} tables; audit chain, wallet ledger and network volume all check out')
PY
psql "$PG/postgres" -qc "DROP DATABASE IF EXISTS mlm_restore WITH (FORCE)" -c "DROP DATABASE IF EXISTS mlm_repro_a WITH (FORCE)" -c "DROP DATABASE IF EXISTS mlm_repro_b WITH (FORCE)"

step "All release checks passed"
