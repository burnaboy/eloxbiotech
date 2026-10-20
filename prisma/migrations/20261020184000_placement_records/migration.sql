-- CreateEnum
CREATE TYPE "PlacementMethod" AS ENUM ('AUTO', 'SPONSOR_CHOICE', 'ADMIN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "placementPending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requestedLeg" "Leg";

-- CreateTable
CREATE TABLE "PlacementRecord" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sponsorId" TEXT,
    "parentId" TEXT,
    "position" "Leg",
    "method" "PlacementMethod" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlacementRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlacementRecord_nodeId_key" ON "PlacementRecord"("nodeId");

-- AddForeignKey
ALTER TABLE "PlacementRecord" ADD CONSTRAINT "PlacementRecord_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "AffiliateNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Placements are permanent. The database itself refuses to move a member, change a sponsor,
-- or edit/delete a placement record, so no application bug or admin can rewrite the tree.
CREATE OR REPLACE FUNCTION forbid_placement_change() RETURNS trigger AS $$
BEGIN
  IF NEW."parentId" IS DISTINCT FROM OLD."parentId"
     OR NEW."position" IS DISTINCT FROM OLD."position"
     OR NEW."ancestorIds" IS DISTINCT FROM OLD."ancestorIds"
     OR NEW."userId" IS DISTINCT FROM OLD."userId" THEN
    RAISE EXCEPTION 'Binary placements cannot be changed once made';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER affiliate_node_immutable BEFORE UPDATE ON "AffiliateNode" FOR EACH ROW EXECUTE FUNCTION forbid_placement_change();

CREATE OR REPLACE FUNCTION forbid_sponsor_change() RETURNS trigger AS $$
BEGIN
  IF OLD."sponsorId" IS NOT NULL AND NEW."sponsorId" IS DISTINCT FROM OLD."sponsorId" THEN
    RAISE EXCEPTION 'A member''s sponsor cannot be changed once set';
  END IF;
  IF NEW."sponsorId" = NEW."id" THEN
    RAISE EXCEPTION 'A member cannot sponsor themselves';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER user_sponsor_immutable BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION forbid_sponsor_change();
ALTER TABLE "User" ADD CONSTRAINT "User_not_self_sponsored" CHECK ("sponsorId" IS NULL OR "sponsorId" <> "id");

-- A node can't be its own parent or appear in its own ancestry.
ALTER TABLE "AffiliateNode" ADD CONSTRAINT "AffiliateNode_no_self_parent" CHECK ("parentId" IS NULL OR "parentId" <> "id");
ALTER TABLE "AffiliateNode" ADD CONSTRAINT "AffiliateNode_no_self_ancestor" CHECK (NOT ("id" = ANY("ancestorIds")));
ALTER TABLE "AffiliateNode" ADD CONSTRAINT "AffiliateNode_root_shape" CHECK (("parentId" IS NULL) = ("position" IS NULL));

CREATE OR REPLACE FUNCTION forbid_record_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Placement records are permanent';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER placement_record_immutable BEFORE UPDATE OR DELETE ON "PlacementRecord" FOR EACH ROW EXECUTE FUNCTION forbid_record_change();
