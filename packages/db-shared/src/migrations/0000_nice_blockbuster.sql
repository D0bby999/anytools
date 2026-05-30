CREATE TABLE "blog_products" (
	"blog_id" integer NOT NULL,
	"product_id" integer NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blog_products_blog_id_product_id_pk" PRIMARY KEY("blog_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "blogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(255) NOT NULL,
	"locale" varchar(8) NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"category" varchar(64),
	"keywords" jsonb,
	"frontmatter" jsonb NOT NULL,
	"body_mdx" text NOT NULL,
	"word_count" integer,
	"reading_time" integer,
	"content_sha" varchar(64),
	"published_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "affiliate_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"asin" varchar(32) NOT NULL,
	"brand" varchar(255),
	"title" varchar(500) NOT NULL,
	"category" varchar(64),
	"price_estimate_usd" numeric(10, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "affiliate_products_asin_unique" UNIQUE("asin")
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"url" varchar(2048),
	"locale" varchar(8),
	"session_id" varchar(64),
	"event_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blog_products" ADD CONSTRAINT "blog_products_blog_id_blogs_id_fk" FOREIGN KEY ("blog_id") REFERENCES "public"."blogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blog_products" ADD CONSTRAINT "blog_products_product_id_affiliate_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."affiliate_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blogs_slug_locale_idx" ON "blogs" USING btree ("slug","locale");--> statement-breakpoint
CREATE INDEX "blogs_category_idx" ON "blogs" USING btree ("category");--> statement-breakpoint
CREATE INDEX "blogs_locale_idx" ON "blogs" USING btree ("locale");--> statement-breakpoint
CREATE INDEX "blogs_published_idx" ON "blogs" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "affiliate_products_asin_idx" ON "affiliate_products" USING btree ("asin");--> statement-breakpoint
CREATE INDEX "affiliate_products_category_idx" ON "affiliate_products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "analytics_events_type_idx" ON "analytics_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "analytics_events_created_at_idx" ON "analytics_events" USING btree ("created_at");