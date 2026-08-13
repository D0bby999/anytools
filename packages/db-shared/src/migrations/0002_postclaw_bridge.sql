CREATE TABLE "postclaw_idempotency" (
	"key" varchar(200) PRIMARY KEY NOT NULL,
	"request_sha256" varchar(64) NOT NULL,
	"status_code" integer,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blogs" ADD COLUMN "content_format" text DEFAULT 'mdx' NOT NULL;--> statement-breakpoint
ALTER TABLE "blogs" ADD COLUMN "external_id" varchar(128);--> statement-breakpoint
CREATE INDEX "postclaw_idempotency_created_at_idx" ON "postclaw_idempotency" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "blogs_external_id_idx" ON "blogs" USING btree ("external_id") WHERE "blogs"."external_id" IS NOT NULL;