-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('COMMISSION_EARNED', 'COMMISSION_APPROVED', 'COMMISSION_HELD', 'COMMISSION_RELEASED', 'COMMISSION_REVERSED', 'WITHDRAWAL_RESERVED', 'WITHDRAWAL_PAID', 'WITHDRAWAL_RELEASED', 'ADMIN_CORRECTION');

-- CreateEnum
CREATE TYPE "LedgerBucket" AS ENUM ('PENDING', 'HELD', 'AVAILABLE', 'RESERVED', 'PAID_OUT', 'REVERSED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PayoutStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "PayoutStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "chainPos" INTEGER,
ADD COLUMN     "hash" TEXT,
ADD COLUMN     "prevHash" TEXT,
ADD COLUMN     "seq" SERIAL NOT NULL;

-- AlterTable
ALTER TABLE "Commission" ADD COLUMN     "reversedMinor" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "requestKey" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "fromBucket" "LedgerBucket",
    "toBucket" "LedgerBucket",
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "commissionId" TEXT,
    "payoutId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "memo" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_commissionId_idx" ON "LedgerEntry"("commissionId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_seq_key" ON "AuditLog"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_chainPos_key" ON "AuditLog"("chainPos");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_reference_key" ON "Payout"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_requestKey_key" ON "Payout"("requestKey");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "Commission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Ledger rules ----------
-- Sign convention: every entry moves a positive amount from one bucket to another. A bucket's balance is
-- what flowed in minus what flowed out. NULL on one side means money entering or leaving the member's wallet.
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_valid" CHECK (
  "amountMinor" > 0
  AND ("fromBucket" IS NOT NULL OR "toBucket" IS NOT NULL)
  AND ("fromBucket" IS NULL OR "toBucket" IS NULL OR "fromBucket" <> "toBucket"));

CREATE OR REPLACE FUNCTION forbid_ledger_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Ledger entries are permanent. Post a compensating entry instead.';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_entry_immutable BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_change();

ALTER TABLE "Commission" ADD CONSTRAINT "Commission_amount_valid" CHECK (
  ("amountMinor" > 0 OR "type" = 'ADJUSTMENT') AND "reversedMinor" >= 0
  AND ("amountMinor" < 0 OR "reversedMinor" <= "amountMinor"));
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_amount_positive" CHECK ("amountMinor" > 0);

-- ---------- Audit log: append-only, sealed into a hash chain ----------
-- Rows can't be deleted. The only change allowed is sealing: setting chainPos, prevHash and hash once.
CREATE OR REPLACE FUNCTION guard_audit_log() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Audit records are permanent';
  END IF;
  IF OLD."hash" IS NOT NULL OR NEW."hash" IS NULL OR NEW."chainPos" IS NULL
     OR NEW.id <> OLD.id OR NEW.seq <> OLD.seq OR NEW."actorId" IS DISTINCT FROM OLD."actorId"
     OR NEW.action <> OLD.action OR NEW.entity <> OLD.entity OR NEW."entityId" IS DISTINCT FROM OLD."entityId"
     OR NEW.data IS DISTINCT FROM OLD.data OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'Audit records are permanent';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION guard_audit_log();

-- ---------- Backfill the ledger from existing commissions and payouts ----------
-- Earned (positive commissions).
INSERT INTO "LedgerEntry" (id, "userId", type, "amountMinor", "fromBucket", "toBucket", "sourceType", "sourceId", "commissionId", "idempotencyKey", memo, "createdAt")
SELECT gen_random_uuid()::text, c."userId", 'COMMISSION_EARNED', c."amountMinor", NULL,
       CASE WHEN c.type = 'BINARY' THEN 'AVAILABLE'::"LedgerBucket" ELSE 'PENDING'::"LedgerBucket" END,
       'Commission', c.id, c.id, 'commission:' || c.id || ':earned', 'Backfilled', c."createdAt"
FROM "Commission" c WHERE c."amountMinor" > 0;
-- Direct commissions that have moved on from pending.
INSERT INTO "LedgerEntry" (id, "userId", type, "amountMinor", "fromBucket", "toBucket", "sourceType", "sourceId", "commissionId", "idempotencyKey", memo, "createdAt")
SELECT gen_random_uuid()::text, c."userId",
       CASE c.status WHEN 'HELD' THEN 'COMMISSION_HELD'::"LedgerType" WHEN 'REVERSED' THEN 'COMMISSION_REVERSED'::"LedgerType" ELSE 'COMMISSION_APPROVED'::"LedgerType" END,
       c."amountMinor", 'PENDING',
       CASE c.status WHEN 'HELD' THEN 'HELD'::"LedgerBucket" WHEN 'REVERSED' THEN 'REVERSED'::"LedgerBucket" ELSE 'AVAILABLE'::"LedgerBucket" END,
       'Commission', c.id, c.id, 'commission:' || c.id || ':backfill-status', 'Backfilled', COALESCE(c."approvedAt", c."createdAt")
FROM "Commission" c WHERE c."amountMinor" > 0 AND c.type <> 'BINARY' AND c.status IN ('HELD', 'REVERSED', 'APPROVED', 'PAID');
-- Binary commissions that were held or reversed.
INSERT INTO "LedgerEntry" (id, "userId", type, "amountMinor", "fromBucket", "toBucket", "sourceType", "sourceId", "commissionId", "idempotencyKey", memo, "createdAt")
SELECT gen_random_uuid()::text, c."userId",
       CASE c.status WHEN 'HELD' THEN 'COMMISSION_HELD'::"LedgerType" ELSE 'COMMISSION_REVERSED'::"LedgerType" END,
       c."amountMinor", 'AVAILABLE',
       CASE c.status WHEN 'HELD' THEN 'HELD'::"LedgerBucket" ELSE 'REVERSED'::"LedgerBucket" END,
       'Commission', c.id, c.id, 'commission:' || c.id || ':backfill-status', 'Backfilled', c."createdAt"
FROM "Commission" c WHERE c."amountMinor" > 0 AND c.type = 'BINARY' AND c.status IN ('HELD', 'REVERSED');
UPDATE "Commission" SET "reversedMinor" = "amountMinor" WHERE status = 'REVERSED' AND "amountMinor" > 0;
-- Old clawbacks were negative adjustment rows: they become correction debits.
INSERT INTO "LedgerEntry" (id, "userId", type, "amountMinor", "fromBucket", "toBucket", "sourceType", "sourceId", "commissionId", "idempotencyKey", memo, "createdAt")
SELECT gen_random_uuid()::text, c."userId", 'ADMIN_CORRECTION', -c."amountMinor", 'AVAILABLE', NULL,
       'Commission', c.id, c.id, 'commission:' || c.id || ':backfill-debit', COALESCE(c.note, 'Backfilled deduction'), c."createdAt"
FROM "Commission" c WHERE c."amountMinor" < 0;
-- Payouts: open ones hold reserved funds, paid ones have left.
INSERT INTO "LedgerEntry" (id, "userId", type, "amountMinor", "fromBucket", "toBucket", "sourceType", "sourceId", "payoutId", "idempotencyKey", memo, "createdAt")
SELECT gen_random_uuid()::text, p."userId", 'WITHDRAWAL_RESERVED', p."amountMinor", 'AVAILABLE', 'RESERVED', 'Payout', p.id, p.id,
       'payout:' || p.id || ':reserved', 'Backfilled', p."createdAt"
FROM "Payout" p WHERE p.status IN ('REQUESTED', 'APPROVED', 'PAID');
INSERT INTO "LedgerEntry" (id, "userId", type, "amountMinor", "fromBucket", "toBucket", "sourceType", "sourceId", "payoutId", "idempotencyKey", memo, "createdAt")
SELECT gen_random_uuid()::text, p."userId", 'WITHDRAWAL_PAID', p."amountMinor", 'RESERVED', 'PAID_OUT', 'Payout', p.id, p.id,
       'payout:' || p.id || ':paid', 'Backfilled', COALESCE(p."processedAt", p."createdAt")
FROM "Payout" p WHERE p.status = 'PAID';
