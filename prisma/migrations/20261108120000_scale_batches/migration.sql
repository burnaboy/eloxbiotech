-- Binary runs are processed in batches. completedAt marks a finished run. Earlier runs all finished in one go,
-- so the default fills them in; the app creates new runs with completedAt = NULL.
ALTER TABLE "BinaryRun" ADD COLUMN "completedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

-- Lets a resumed binary run find what it already paid.
CREATE INDEX "Commission_runId_idx" ON "Commission"("runId");

-- Member sales list: a sponsor's referred orders, newest first.
CREATE INDEX "Order_referrerId_paidAt_idx" ON "Order"("referrerId", "paidAt");

-- "Contains" searches on member name and email (admin users page, network search, exports).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "User_name_trgm_idx" ON "User" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "User_email_trgm_idx" ON "User" USING GIN ("email" gin_trgm_ops);
