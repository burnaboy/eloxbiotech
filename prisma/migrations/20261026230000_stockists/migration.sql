-- CreateTable
CREATE TABLE "Stockist" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT,
    "hours" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stockist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Stockist_active_state_idx" ON "Stockist"("active", "state");
