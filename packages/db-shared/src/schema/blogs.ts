import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { affiliateProducts } from './affiliate-products';

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
    publishedAt: timestamp('published_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('blogs_slug_locale_idx').on(t.slug, t.locale),
    index('blogs_category_idx').on(t.category),
    index('blogs_locale_idx').on(t.locale),
    index('blogs_published_idx').on(t.publishedAt),
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
