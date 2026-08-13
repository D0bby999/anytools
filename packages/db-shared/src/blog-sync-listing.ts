/**
 * Keyset-paginated read helper for the PostClaw content-sync (RAG) extension.
 *
 * The cursor is `(synced_at, id)`, never `updated_at`: `updated_at` gets
 * backdated from frontmatter by /do and can be NULL after an mdx-to-sql sync,
 * so it is not a safe resume point. `synced_at` is server-assigned on every
 * write (insert and update alike) and is therefore monotonic and never NULL —
 * a row re-synced mid-crawl gets a fresh `synced_at` and is naturally
 * re-emitted rather than skipped by a consumer resuming from the cursor the
 * server returned.
 */

import { and, asc, eq, gt, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { type Blog, blogs } from './schema';

// Kept structurally compatible with both the schema-typed client (getDb())
// and the wider Record<string, unknown>-typed db used inside store
// implementations — this helper is called from both.
type Db = PostgresJsDatabase<Record<string, unknown>>;

export type BlogSyncCursor = { syncedAt: Date; id: number };

/** Full-content row shape returned by the PostClaw list/get-by-id read endpoints. */
export type BlogSyncRow = Pick<
  Blog,
  | 'id'
  | 'externalId'
  | 'slug'
  | 'locale'
  | 'title'
  | 'description'
  | 'category'
  | 'keywords'
  | 'contentFormat'
  | 'bodyMdx'
  | 'status'
  | 'publishedAt'
  | 'syncedAt'
>;

const SYNC_COLUMNS = {
  id: blogs.id,
  externalId: blogs.externalId,
  slug: blogs.slug,
  locale: blogs.locale,
  title: blogs.title,
  description: blogs.description,
  category: blogs.category,
  keywords: blogs.keywords,
  contentFormat: blogs.contentFormat,
  bodyMdx: blogs.bodyMdx,
  status: blogs.status,
  publishedAt: blogs.publishedAt,
  syncedAt: blogs.syncedAt,
} as const;

/** Wire format `<synced_at ISO>.<id>`; the id suffix breaks ties at identical timestamps. */
export function encodeBlogSyncCursor(cursor: BlogSyncCursor): string {
  return `${cursor.syncedAt.toISOString()}.${cursor.id}`;
}

/**
 * Parse the wire cursor. Returns null on any malformed input — the caller
 * (the route handler) turns that into a 400, never a 500: an ISO timestamp
 * itself contains a `.` (fractional seconds), so the id is split off at the
 * LAST `.` rather than the first.
 */
export function decodeBlogSyncCursor(raw: string): BlogSyncCursor | null {
  const splitAt = raw.lastIndexOf('.');
  if (splitAt <= 0 || splitAt === raw.length - 1) return null;
  const idPart = raw.slice(splitAt + 1);
  if (!/^\d+$/.test(idPart)) return null;
  const id = Number(idPart);
  // Upper bound = int4 max: blogs.id is serial, and an id that passes JS
  // validation but overflows int4 would raise 22003 at the SQL layer — a 500
  // where the contract promises a terminal 400 for malformed cursors.
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return null;
  const syncedAt = new Date(raw.slice(0, splitAt));
  // Same reasoning for dates: pre-epoch values are never server-issued and
  // extreme ones underflow timestamptz — reject instead of 500ing.
  if (Number.isNaN(syncedAt.getTime()) || syncedAt.getTime() < 0) return null;
  return { syncedAt, id };
}

/**
 * Keyset page of published posts ordered `synced_at ASC, id ASC`.
 *
 * `locale === 'all'` skips the locale filter; any other value matches
 * exactly (no en-fallback merging — this is a raw corpus crawl, not a
 * render path). `cursor === null` starts from the first published row.
 * The caller owns `perPage` bounds checking; this trusts its input.
 */
export async function listBlogsForSync(
  db: Db,
  opts: { cursor: BlogSyncCursor | null; perPage: number; locale: string },
): Promise<BlogSyncRow[]> {
  const { cursor, perPage, locale } = opts;

  // (synced_at, id) > (cursor.syncedAt, cursor.id), expanded to the
  // equivalent OR form Postgres understands from Drizzle's builder:
  // strictly-later timestamp, OR same timestamp with a strictly-greater id.
  const cursorCondition = cursor
    ? or(
        gt(blogs.syncedAt, cursor.syncedAt),
        and(eq(blogs.syncedAt, cursor.syncedAt), gt(blogs.id, cursor.id)),
      )
    : undefined;

  return db
    .select(SYNC_COLUMNS)
    .from(blogs)
    .where(
      and(
        eq(blogs.status, 'published'),
        locale === 'all' ? undefined : eq(blogs.locale, locale),
        cursorCondition,
      ),
    )
    .orderBy(asc(blogs.syncedAt), asc(blogs.id))
    .limit(perPage);
}
