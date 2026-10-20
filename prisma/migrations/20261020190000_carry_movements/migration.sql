-- CreateEnum
CREATE TYPE "CarryReason" AS ENUM ('BINARY_RUN', 'REVERSAL_FLOOR');

-- CreateTable
CREATE TABLE "CarryMovement" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "leg" "Leg" NOT NULL,
    "pv" INTEGER NOT NULL,
    "reason" "CarryReason" NOT NULL,
    "runId" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CarryMovement_nodeId_idx" ON "CarryMovement"("nodeId");

-- CreateIndex
CREATE INDEX "CarryMovement_runId_idx" ON "CarryMovement"("runId");

-- AddForeignKey
ALTER TABLE "CarryMovement" ADD CONSTRAINT "CarryMovement_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "AffiliateNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarryMovement" ADD CONSTRAINT "CarryMovement_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BinaryRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

