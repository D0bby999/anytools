import { blogs, postclawIdempotency } from '@anytools/db-shared';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  BlogRowLite,
  BlogStore,
  IdempotencyStore,
  InsertPostResult,
  PostclawBlogInsert,
  PostclawBlogPatch,
  ReserveResult,
} from './types';

type Db = PostgresJsDatabase<Record<string, unknown>>;

const LITE_COLUMNS = {
  id: blogs.id,
  slug: blogs.slug,
  locale: blogs.locale,
  status: blogs.status,
  externalId: blogs.externalId,
  publishedAt: blogs.publishedAt,
} as const;

// postgres.js surfaces unique violations as code 23505 with the index name in
// constraint_name (or the message); discriminate WHICH constraint fired —
// treating an external_id race as a slug collision (or vice versa) was a
// red-team finding, not a hypothetical.
function uniqueConflictOf(err: unknown): 'external_id' | 'slug' | null {
  const e = err as { code?: string; constraint_name?: string; message?: string };
  if (e?.code !== '23505') return null;
  const name = e.constraint_name ?? e.message ?? '';
  if (name.includes('external_id')) return 'external_id';
  if (name.includes('slug_locale')) return 'slug';
  return null;
}

export function createDrizzleBlogStore(db: Db): BlogStore {
  return {
    async findByExternalId(externalId: string): Promise<BlogRowLite | null> {
      const [row] = await db
        .select(LITE_COLUMNS)
        .from(blogs)
        .where(eq(blogs.externalId, externalId))
        .limit(1);
      return row ?? null;
    },

    async findBySlugLocale(slug: string, locale: string): Promise<BlogRowLite | null> {
      const [row] = await db
        .select(LITE_COLUMNS)
        .from(blogs)
        .where(and(eq(blogs.slug, slug), eq(blogs.locale, locale)))
        .limit(1);
      return row ?? null;
    },

    async insertPost(input: PostclawBlogInsert): Promise<InsertPostResult> {
      try {
        const [row] = await db
          .insert(blogs)
          .values({ ...input, syncedAt: new Date(), updatedAt: new Date() })
          .returning(LITE_COLUMNS);
        if (!row) return { ok: false, conflict: 'slug' };
        return { ok: true, row };
      } catch (err) {
        const conflict = uniqueConflictOf(err);
        if (conflict) return { ok: false, conflict };
        throw err;
      }
    },

    async updateByExternalId(
      externalId: string,
      patch: PostclawBlogPatch,
    ): Promise<BlogRowLite | null> {
      const [row] = await db
        .update(blogs)
        .set({ ...patch, updatedAt: new Date(), syncedAt: new Date() })
        .where(eq(blogs.externalId, externalId))
        .returning(LITE_COLUMNS);
      return row ?? null;
    },
  };
}

/** Reservations older than this with no response are treated as crashed and taken over. */
const STALE_RESERVATION_MS = 60_000;

export function createDrizzleIdempotencyStore(db: Db): IdempotencyStore {
  return {
    async reserve(key: string, requestSha256: string): Promise<ReserveResult> {
      const inserted = await db
        .insert(postclawIdempotency)
        .values({ key, requestSha256 })
        .onConflictDoNothing()
        .returning({ key: postclawIdempotency.key });
      if (inserted.length > 0) return { state: 'reserved' };

      const [row] = await db
        .select()
        .from(postclawIdempotency)
        .where(eq(postclawIdempotency.key, key))
        .limit(1);
      if (!row) return { state: 'reserved' }; // released between insert and select — extremely rare; proceed
      if (row.requestSha256 !== requestSha256) return { state: 'mismatch' };
      if (row.statusCode !== null && row.response !== null) {
        return { state: 'replay', statusCode: row.statusCode, response: row.response };
      }

      // Response-less row: in-flight peer, or a crashed owner. Take over stale ones.
      const staleCutoff = new Date(Date.now() - STALE_RESERVATION_MS);
      const takeover = await db
        .update(postclawIdempotency)
        .set({ requestSha256, createdAt: new Date() })
        .where(
          and(
            eq(postclawIdempotency.key, key),
            isNull(postclawIdempotency.statusCode),
            lt(postclawIdempotency.createdAt, staleCutoff),
          ),
        )
        .returning({ key: postclawIdempotency.key });
      return takeover.length > 0 ? { state: 'reserved' } : { state: 'in_flight' };
    },

    async complete(
      key: string,
      statusCode: number,
      response: Record<string, unknown>,
    ): Promise<void> {
      await db
        .update(postclawIdempotency)
        .set({ statusCode, response })
        .where(eq(postclawIdempotency.key, key));
    },

    async release(key: string): Promise<void> {
      await db
        .delete(postclawIdempotency)
        .where(and(eq(postclawIdempotency.key, key), isNull(postclawIdempotency.statusCode)));
    },
  };
}

/** Prune replay-cache rows older than `days` (housekeeping; growth is tiny). */
export async function pruneIdempotencyRows(db: Db, days = 90): Promise<void> {
  await db
    .delete(postclawIdempotency)
    .where(lt(postclawIdempotency.createdAt, sql`now() - make_interval(days => ${days})`));
}
