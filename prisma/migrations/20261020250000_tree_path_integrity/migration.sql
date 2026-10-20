-- Every position's stored path must match its parent, checked by the database on insert.
-- With placements already permanent (no updates), this means the tree can never hold a cycle,
-- a wrong depth, or an ancestry that disagrees with the parent links.
CREATE OR REPLACE FUNCTION check_node_path() RETURNS trigger AS $$
DECLARE p RECORD;
BEGIN
  IF NEW."parentId" IS NULL THEN
    IF NEW."depth" <> 0 OR cardinality(NEW."ancestorIds") <> 0 THEN
      RAISE EXCEPTION 'The network root must have depth 0 and no ancestors';
    END IF;
    RETURN NEW;
  END IF;
  SELECT "id", "depth", "ancestorIds" INTO p FROM "AffiliateNode" WHERE "id" = NEW."parentId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent position % does not exist', NEW."parentId";
  END IF;
  IF NEW."depth" <> p."depth" + 1 OR NEW."ancestorIds" IS DISTINCT FROM (p."ancestorIds" || p."id") THEN
    RAISE EXCEPTION 'Position path does not match its parent';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER affiliate_node_path BEFORE INSERT ON "AffiliateNode" FOR EACH ROW EXECUTE FUNCTION check_node_path();

-- There is exactly one network root.
CREATE UNIQUE INDEX "AffiliateNode_single_root" ON "AffiliateNode" ((true)) WHERE "parentId" IS NULL;
