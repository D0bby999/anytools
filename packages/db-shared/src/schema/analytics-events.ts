import { bigserial, index, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    url: varchar('url', { length: 2048 }),
    locale: varchar('locale', { length: 8 }),
    sessionId: varchar('session_id', { length: 64 }),
    eventData: jsonb('event_data').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('analytics_events_type_idx').on(t.eventType),
    index('analytics_events_created_at_idx').on(t.createdAt),
  ],
);

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type NewAnalyticsEvent = typeof analyticsEvents.$inferInsert;
