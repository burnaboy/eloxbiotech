-- CreateEnum
CREATE TYPE "PayoutAccountStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "PayoutBatchStatus" AS ENUM ('OPEN', 'EXPORTED', 'CLOSED');

-- AlterEnum
ALTER TYPE "AdminPermission" ADD VALUE IF NOT EXISTS 'PAYOUT_DETAILS';

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "payoutAccountId" TEXT,
ADD COLUMN     "settledAt" TIMESTAMP(3),
ADD COLUMN     "settlementEvidence" TEXT,
ADD COLUMN     "settlementSource" TEXT;

-- CreateTable
CREATE TABLE "PayoutAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "accountNumberEnc" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "usableFrom" TIMESTAMP(3) NOT NULL,
    "status" "PayoutAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "PayoutAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutBatch" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "PayoutBatchStatus" NOT NULL DEFAULT 'OPEN',
    "totalMinor" INTEGER NOT NULL,
    "count" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "exportedById" TEXT,
    "exportedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayoutAccount_userId_status_idx" ON "PayoutAccount"("userId", "status");

-- CreateIndex
CREATE INDEX "PayoutAccount_fingerprint_idx" ON "PayoutAccount"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutBatch_number_key" ON "PayoutBatch"("number");

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_payoutAccountId_fkey" FOREIGN KEY ("payoutAccountId") REFERENCES "PayoutAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PayoutBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutAccount" ADD CONSTRAINT "PayoutAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One active bank account per member.
CREATE UNIQUE INDEX "PayoutAccount_one_active" ON "PayoutAccount"("userId") WHERE status = 'ACTIVE';
-- One open withdrawal per member at a time: a second request can't be created, even by a race.
CREATE UNIQUE INDEX "Payout_one_open_per_member" ON "Payout"("userId") WHERE status IN ('REQUESTED', 'APPROVED', 'PROCESSING');
-- Payouts recorded as paid before evidence was required.
UPDATE "Payout" SET "settlementSource" = 'legacy', "settledAt" = COALESCE("processedAt", "createdAt"),
  "settlementEvidence" = 'Recorded before settlement evidence was required', "reference" = COALESCE("reference", 'legacy-' || id)
  WHERE status = 'PAID';
-- A payout can only be recorded as paid with a transfer reference and settlement evidence.
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_paid_has_evidence" CHECK (
  status <> 'PAID' OR ("reference" IS NOT NULL AND "settledAt" IS NOT NULL AND "settlementSource" IS NOT NULL AND "settlementEvidence" IS NOT NULL));
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_attempt_positive" CHECK ("attempt" >= 1);
