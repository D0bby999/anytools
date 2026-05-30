import {
  pgTable,
  serial,
  varchar,
  text,
  numeric,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export const affiliateProducts = pgTable(
  'affiliate_products',
  {
    id: serial('id').primaryKey(),
    asin: varchar('asin', { length: 32 }).notNull().unique(),
    brand: varchar('brand', { length: 255 }),
    title: varchar('title', { length: 500 }).notNull(),
    category: varchar('category', { length: 64 }),
    priceEstimateUsd: numeric('price_estimate_usd', { precision: 10, scale: 2 }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('affiliate_products_asin_idx').on(t.asin),
    index('affiliate_products_category_idx').on(t.category),
  ],
);

export type AffiliateProduct = typeof affiliateProducts.$inferSelect;
export type NewAffiliateProduct = typeof affiliateProducts.$inferInsert;
