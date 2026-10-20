-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paidPaymentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Order_paidPaymentId_key" ON "Order"("paidPaymentId");


-- Existing paid orders: the first successful payment is the one that paid them.
UPDATE "Order" o SET "paidPaymentId" = p.id
FROM (
  SELECT DISTINCT ON ("orderId") id, "orderId" FROM "Payment"
  WHERE status IN ('SUCCEEDED', 'REFUNDED', 'PARTIALLY_REFUNDED')
  ORDER BY "orderId", "createdAt"
) p
WHERE p."orderId" = o.id AND o.status NOT IN ('PENDING_PAYMENT', 'CANCELLED');
