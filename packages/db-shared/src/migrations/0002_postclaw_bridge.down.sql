-- Manual abort script for 0002_postclaw_bridge (run via psql; drizzle journal
-- does not track down migrations — also delete the 0002 row from
-- drizzle.__drizzle_migrations if you roll back a DB that already applied it).
-- Safe on live traffic: old app images never reference these columns/tables.
DROP INDEX IF EXISTS "blogs_external_id_idx";
ALTER TABLE "blogs" DROP COLUMN IF EXISTS "external_id";
ALTER TABLE "blogs" DROP COLUMN IF EXISTS "content_format";
DROP TABLE IF EXISTS "postclaw_idempotency";
