import { index, integer, jsonb, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Replay cache for the PostClaw custom_blog contract's Idempotency-Key header.
 *
 * key = the HEADER value (PostClaw scopes it per method+content: bare
 * "postclaw_<uuid>" on POST, "postclaw_<uuid>.u.<12-hex body hash>" on PATCH),
 * NOT the body's external_id — caching by external_id would replay a create's
 * response for an unrelated update.
 *
 * Rows are INSERTed as a reservation BEFORE the handler runs (statusCode and
 * response stay NULL while in flight) so two concurrent identical requests
 * can't both execute. Only 2xx responses are written back: PostClaw retries a
 * request with the SAME key, so a cached 5xx/429 would poison the key forever.
 *
 * requestSha256 detects a repeated key with a DIFFERENT body — the contract
 * says to reject that (409), never silently apply it.
 *
 * Growth is bounded by post count × edits (small). Prune rows older than ~90
 * days via the createdAt index if it ever matters.
 */
export const postclawIdempotency = pgTable(
  'postclaw_idempotency',
  {
    key: varchar('key', { length: 200 }).primaryKey(),
    requestSha256: varchar('request_sha256', { length: 64 }).notNull(),
    statusCode: integer('status_code'),
    response: jsonb('response').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('postclaw_idempotency_created_at_idx').on(t.createdAt)],
);

export type PostclawIdempotencyRow = typeof postclawIdempotency.$inferSelect;
export type NewPostclawIdempotencyRow = typeof postclawIdempotency.$inferInsert;
