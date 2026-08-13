import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { affiliateProducts } from './affiliate-products';

export type BlogStatus = 'draft' | 'published';
// 'mdx' = authored as MDX (git-synced); 'html' = sanitized HTML ingested via the
// PostClaw custom_blog endpoints — rendered through the per-app html body component.
export type BlogContentFormat = 'mdx' | 'html';

export const blogs = pgTable(
  'blogs',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 255 }).notNull(),
    locale: varchar('locale', { length: 8 }).notNull(),
    title: varchar('title', { length: 500 }).notNull(),
    description: text('description'),
    category: varchar('category', { length: 64 }),
    keywords: jsonb('keywords').$type<string[]>(),
    frontmatter: jsonb('frontmatter').$type<Record<string, unknown>>().notNull(),
    bodyMdx: text('body_mdx').notNull(),
    wordCount: integer('word_count'),
    readingTime: integer('reading_time'),
    contentSha: varchar('content_sha', { length: 64 }),
    contentFormat: text('content_format').notNull().$type<BlogContentFormat>().default('mdx'),
    // PostClaw custom_blog resource identity ("postclaw_<uuid>"). Non-null marks the
    // row as externally authored: it has no MDX source file, so the MDX sync must
    // never overwrite or delete it. Provenance IS this column — no separate flag.
    externalId: varchar('external_id', { length: 128 }),
    // 'draft' = gate found blockers or not yet verified; 'published' = gate-clean
    status: text('status').notNull().$type<BlogStatus>().default('draft'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // Keyset sync cursor component: every writer MUST stamp this explicitly
    // with a JS `new Date()` (ms precision). Relying on the µs-precision DB
    // default would make the cursor's equality tie-break unmatchable and stall
    // pagination at that row.
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('blogs_slug_locale_idx').on(t.slug, t.locale),
    uniqueIndex('blogs_external_id_idx').on(t.externalId).where(sql`${t.externalId} IS NOT NULL`),
    index('blogs_category_idx').on(t.category),
    index('blogs_locale_idx').on(t.locale),
    index('blogs_published_idx').on(t.publishedAt),
    // Render/sitemap queries: list published rows per locale ordered by date
    index('blogs_locale_status_idx').on(t.locale, t.status, t.publishedAt),
  ],
);

export const blogProducts = pgTable(
  'blog_products',
  {
    blogId: integer('blog_id')
      .notNull()
      .references(() => blogs.id, { onDelete: 'cascade' }),
    productId: integer('product_id')
      .notNull()
      .references(() => affiliateProducts.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.blogId, t.productId] })],
);

export type Blog = typeof blogs.$inferSelect;
export type NewBlog = typeof blogs.$inferInsert;
export type BlogProduct = typeof blogProducts.$inferSelect;
