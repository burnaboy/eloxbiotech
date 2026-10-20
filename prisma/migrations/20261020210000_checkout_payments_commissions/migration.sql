-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('PERCENT', 'FIXED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "OrderStatus" ADD VALUE 'PARTIALLY_REFUNDED';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';

-- AlterTable
ALTER TABLE "Commission" ADD COLUMN     "baseMinor" INTEGER,
ADD COLUMN     "planVersionId" TEXT,
ADD COLUMN     "rateBps" INTEGER;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "checkoutKey" TEXT,
ADD COLUMN     "confirmationSentAt" TIMESTAMP(3),
ADD COLUMN     "discountCode" TEXT,
ADD COLUMN     "discountMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "planVersionId" TEXT,
ADD COLUMN     "processingAt" TIMESTAMP(3),
ADD COLUMN     "refundedMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundedPv" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxIncluded" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "taxMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxRateBps" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "commissionable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "discountMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "netMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paidMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundedMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundedNetMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundedQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "taxMinor" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "authorizationUrl" TEXT,
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "refundedMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "commissionable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "taxExempt" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "WebhookEvent" ADD COLUMN     "payload" JSONB,
ADD COLUMN     "providerRef" TEXT,
ADD COLUMN     "result" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'webhook';

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "providerRefundId" TEXT,
    "reason" TEXT NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'admin',
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" "DiscountType" NOT NULL,
    "value" INTEGER NOT NULL,
    "minSubtotalMinor" INTEGER NOT NULL DEFAULT 0,
    "maxDiscountMinor" INTEGER,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "maxRedemptions" INTEGER,
    "perCustomerLimit" INTEGER NOT NULL DEFAULT 1,
    "redeemedCount" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscountCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscountRedemption" (
    "id" TEXT NOT NULL,
    "codeId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompPlanVersion" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "rules" JSONB NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompPlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Refund_providerRefundId_key" ON "Refund"("providerRefundId");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountCode_code_key" ON "DiscountCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DiscountRedemption_orderId_key" ON "DiscountRedemption"("orderId");

-- CreateIndex
CREATE INDEX "DiscountRedemption_codeId_userId_idx" ON "DiscountRedemption"("codeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "CompPlanVersion_version_key" ON "CompPlanVersion"("version");

-- CreateIndex
CREATE UNIQUE INDEX "Order_checkoutKey_key" ON "Order"("checkoutKey");

-- CreateIndex
CREATE INDEX "WebhookEvent_providerRef_idx" ON "WebhookEvent"("providerRef");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "CompPlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountRedemption" ADD CONSTRAINT "DiscountRedemption_codeId_fkey" FOREIGN KEY ("codeId") REFERENCES "DiscountCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountRedemption" ADD CONSTRAINT "DiscountRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "CompPlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Existing order lines: no discounts or VAT existed, so paid and net amounts are the line totals.
UPDATE "OrderItem" SET "paidMinor" = "unitPriceMinor" * "quantity", "netMinor" = "unitPriceMinor" * "quantity";
UPDATE "OrderItem" oi SET "refundedQty" = oi."quantity", "refundedMinor" = oi."paidMinor", "refundedNetMinor" = oi."netMinor"
  FROM "Order" o WHERE o.id = oi."orderId" AND o.status = 'REFUNDED';
UPDATE "Order" SET "refundedMinor" = "totalMinor", "refundedPv" = "totalPv" WHERE status = 'REFUNDED';

-- Money and quantity sanity at the database level.
ALTER TABLE "Order" ADD CONSTRAINT "Order_amounts_valid" CHECK (
  "subtotalMinor" >= 0 AND "discountMinor" >= 0 AND "discountMinor" <= "subtotalMinor" AND "shippingMinor" >= 0 AND "taxMinor" >= 0
  AND "totalMinor" >= 0 AND "refundedMinor" >= 0 AND "refundedMinor" <= "totalMinor" AND "refundedPv" >= 0 AND "refundedPv" <= "totalPv");
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_refunds_valid" CHECK (
  "refundedQty" >= 0 AND "refundedQty" <= "quantity" AND "refundedMinor" >= 0 AND "refundedMinor" <= "paidMinor"
  AND "refundedNetMinor" >= 0 AND "refundedNetMinor" <= "netMinor");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_refund_valid" CHECK ("refundedMinor" >= 0 AND "refundedMinor" <= "amountMinor");
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "DiscountCode" ADD CONSTRAINT "DiscountCode_valid" CHECK (
  "code" = upper("code") AND "value" > 0 AND ("type" <> 'PERCENT' OR "value" <= 10000) AND "redeemedCount" >= 0
  AND ("maxRedemptions" IS NULL OR "redeemedCount" <= "maxRedemptions") AND "perCustomerLimit" >= 1);
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_rate_valid" CHECK ("rateBps" IS NULL OR ("rateBps" >= 0 AND "rateBps" <= 10000));

-- Plan versions are a permanent record: they can be added, never changed or removed.
CREATE OR REPLACE FUNCTION forbid_plan_version_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Compensation plan versions are permanent';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER comp_plan_version_immutable BEFORE UPDATE OR DELETE ON "CompPlanVersion"
  FOR EACH ROW EXECUTE FUNCTION forbid_plan_version_change();
