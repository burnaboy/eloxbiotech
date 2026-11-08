-- One account per person: one per mailbox and one per phone number.
--
-- "emailCanonical" is the email with the parts that still reach the same inbox removed:
-- anything after a "+" (john+2@x.com reaches john@x.com) and, for Gmail, dots in the name
-- (j.o.h.n@gmail.com reaches john@gmail.com; googlemail.com is the same as gmail.com).
-- "phoneNormalized" is the phone in international form, so 0803 123 4567, 08031234567 and
-- +234 803 123 4567 are the same number. Numbers without a country code are read as Nigerian.
--
-- Both are set here by the database, for every insert and every change, so no code path can skip them.
-- Their unique indexes make a second sign-up fail even when two arrive at the same moment.

CREATE OR REPLACE FUNCTION canonical_email(e text) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE
    WHEN x.d IN ('gmail.com', 'googlemail.com') THEN replace(x.l, '.', '') || '@gmail.com'
    ELSE x.l || '@' || x.d
  END
  FROM (
    SELECT COALESCE(NULLIF(split_part(split_part(lower(trim(e)), '@', 1), '+', 1), ''), split_part(lower(trim(e)), '@', 1)) AS l,
           split_part(lower(trim(e)), '@', 2) AS d
  ) x
$$;

CREATE OR REPLACE FUNCTION normalize_phone(p text) RETURNS text LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  intl boolean := left(trim(p), 1) = '+';
  digits text := regexp_replace(p, '\D', '', 'g');
BEGIN
  IF NOT intl AND digits LIKE '00%' THEN
    digits := substr(digits, 3);
  ELSIF NOT intl AND length(digits) = 11 AND digits LIKE '0%' THEN
    digits := '234' || substr(digits, 2);
  ELSIF NOT intl AND length(digits) = 10 AND digits ~ '^[789]' THEN
    digits := '234' || digits;
  END IF;
  IF length(digits) < 7 OR length(digits) > 15 THEN
    RETURN NULL;
  END IF;
  RETURN '+' || digits;
END
$$;

ALTER TABLE "User" ADD COLUMN "emailCanonical" TEXT;
ALTER TABLE "User" ADD COLUMN "phoneNormalized" TEXT;

-- Existing members: the oldest account keeps the email or phone. Any later duplicate is left empty
-- and listed on Admin > Risk for a person to review; nothing is deleted or blocked.
UPDATE "User" u SET "emailCanonical" = k.c
FROM (SELECT id, canonical_email(email) AS c, row_number() OVER (PARTITION BY canonical_email(email) ORDER BY "createdAt", id) AS n FROM "User") k
WHERE k.id = u.id AND k.n = 1;

UPDATE "User" u SET "phoneNormalized" = k.c
FROM (SELECT id, normalize_phone(phone) AS c, row_number() OVER (PARTITION BY normalize_phone(phone) ORDER BY "createdAt", id) AS n FROM "User" WHERE normalize_phone(phone) IS NOT NULL) k
WHERE k.id = u.id AND k.n = 1;

CREATE UNIQUE INDEX "User_emailCanonical_key" ON "User"("emailCanonical");
CREATE UNIQUE INDEX "User_phoneNormalized_key" ON "User"("phoneNormalized");

-- Keeps both columns in step with email and phone. On an update they are only recomputed when the
-- email or phone actually changes, so a grandfathered duplicate can still edit the rest of its profile.
CREATE OR REPLACE FUNCTION set_user_identity() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW."email" IS DISTINCT FROM OLD."email" THEN
    NEW."emailCanonical" := canonical_email(NEW."email");
  ELSE
    NEW."emailCanonical" := OLD."emailCanonical";
  END IF;
  IF TG_OP = 'INSERT' OR NEW."phone" IS DISTINCT FROM OLD."phone" THEN
    NEW."phoneNormalized" := normalize_phone(NEW."phone");
  ELSE
    NEW."phoneNormalized" := OLD."phoneNormalized";
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_identity BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION set_user_identity();
