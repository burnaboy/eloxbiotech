-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- AlterEnum
ALTER TYPE "AdminPermission" ADD VALUE 'PRODUCT_COSTS';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InventoryReason" ADD VALUE 'RETURN_RESTOCK';
ALTER TYPE "InventoryReason" ADD VALUE 'RETURN_WRITE_OFF';

-- DropIndex
DROP INDEX "CartItem_userId_productId_key";

-- AlterTable
ALTER TABLE "CartItem" ADD COLUMN     "variantId" TEXT,
ADD COLUMN     "variantKey" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "balance" INTEGER,
ADD COLUMN     "variantId" TEXT;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "listPriceMinor" INTEGER,
ADD COLUMN     "restockedQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "variantId" TEXT,
ADD COLUMN     "variantName" TEXT,
ADD COLUMN     "writtenOffQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "attributes" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "costPriceMinor" INTEGER,
ADD COLUMN     "heightMm" INTEGER,
ADD COLUMN     "lengthMm" INTEGER,
ADD COLUMN     "listPriceMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lowStockAlertedAt" TIMESTAMP(3),
ADD COLUMN     "metaDescription" TEXT,
ADD COLUMN     "metaTitle" TEXT,
ADD COLUMN     "saleEndsAt" TIMESTAMP(3),
ADD COLUMN     "salePriceMinor" INTEGER,
ADD COLUMN     "saleStartsAt" TIMESTAMP(3),
ADD COLUMN     "shippable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "widthMm" INTEGER;

-- Carry existing data across: visibility becomes a publication status, list price starts at the price.
UPDATE "Product" SET "status" = CASE WHEN "active" THEN 'ACTIVE'::"ProductStatus" ELSE 'ARCHIVED'::"ProductStatus" END, "listPriceMinor" = "priceMinor";

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '{}',
    "priceMinor" INTEGER,
    "salePriceMinor" INTEGER,
    "costPriceMinor" INTEGER,
    "pv" INTEGER,
    "weightGrams" INTEGER,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "lowStockThreshold" INTEGER,
    "lowStockAlertedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt" TEXT NOT NULL DEFAULT '',
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImage_storageKey_key" ON "ProductImage"("storageKey");

-- CreateIndex
CREATE INDEX "ProductImage_productId_sortOrder_idx" ON "ProductImage"("productId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_userId_productId_variantKey_key" ON "CartItem"("userId", "productId", "variantKey");

-- CreateIndex
CREATE INDEX "Product_status_listPriceMinor_idx" ON "Product"("status", "listPriceMinor");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Existing image URLs become image rows (marked external: they weren't uploaded through storage).
INSERT INTO "ProductImage" ("id", "productId", "storageKey", "url", "alt", "width", "height", "bytes", "sortOrder")
SELECT 'mig' || md5(p.id || u.url), p.id, 'external:' || md5(p.id || u.url), u.url, p.name, 0, 0, 0, u.ord::int
FROM "Product" p,
  LATERAL (SELECT p."imageUrl" AS url, 0 AS ord WHERE p."imageUrl" IS NOT NULL
           UNION ALL SELECT x, i FROM unnest(p."images") WITH ORDINALITY AS t(x, i)) u
ON CONFLICT DO NOTHING;

ALTER TABLE "Product" DROP COLUMN "active", DROP COLUMN "imageUrl", DROP COLUMN "images";

-- Stock can never go negative, whatever the application does: this is the last line against overselling.
ALTER TABLE "Product" ADD CONSTRAINT "Product_stock_nonnegative" CHECK ("stock" >= 0);
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_stock_nonnegative" CHECK ("stock" >= 0);
ALTER TABLE "Product" ADD CONSTRAINT "Product_prices_valid" CHECK (
  "priceMinor" >= 0 AND ("salePriceMinor" IS NULL OR ("salePriceMinor" >= 0 AND "salePriceMinor" < "priceMinor"))
  AND ("costPriceMinor" IS NULL OR "costPriceMinor" >= 0) AND "pv" >= 0 AND "weightGrams" >= 0
  AND ("saleStartsAt" IS NULL OR "saleEndsAt" IS NULL OR "saleStartsAt" < "saleEndsAt"));
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_prices_valid" CHECK (
  ("priceMinor" IS NULL OR "priceMinor" >= 0) AND ("salePriceMinor" IS NULL OR "salePriceMinor" >= 0)
  AND ("costPriceMinor" IS NULL OR "costPriceMinor" >= 0) AND ("pv" IS NULL OR "pv" >= 0));
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_variant_key" CHECK ("variantKey" = COALESCE("variantId", ''));
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_returns_valid" CHECK ("quantity" > 0 AND "restockedQty" >= 0 AND "writtenOffQty" >= 0 AND "restockedQty" + "writtenOffQty" <= "quantity");
