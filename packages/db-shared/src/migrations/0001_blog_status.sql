-- Additive migration: add status column + render/sitemap index to blogs table.
--
-- Safe for existing anytools and besttoys databases:
--   • ALTER TABLE ... ADD COLUMN with DEFAULT 'draft' back-fills existing rows.
--   • Existing data is not removed or altered.
--   • Apply to BOTH project DBs:
--       DATABASE_URL=<anytools-db-url>  pnpm --filter @anytools/db-shared db:migrate
--       DATABASE_URL=<besttoys-db-url>  pnpm --filter @anytools/db-shared db:migrate
--
ALTER TABLE "blogs" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
CREATE INDEX "blogs_locale_status_idx" ON "blogs" USING btree ("locale","status","published_at");
