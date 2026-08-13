import type {
  BlogRowLite,
  BlogStore,
  BlogSyncRow,
  IdempotencyStore,
  InsertPostResult,
  PostclawBlogInsert,
  PostclawBlogPatch,
  ReserveResult,
} from '../types';

/** Extra columns the read (content-sync) path needs that the write path's BlogRowLite omits. */
type FakeBlogRow = BlogRowLite & {
  title: string;
  description: string | null;
  category: string | null;
  keywords: string[] | null;
  contentFormat: BlogSyncRow['contentFormat'];
  bodyMdx: string;
  syncedAt: Date;
};

function toSyncRow(row: FakeBlogRow): BlogSyncRow {
  return {
    id: row.id,
    externalId: row.externalId,
    slug: row.slug,
    locale: row.locale,
    title: row.title,
    description: row.description,
    category: row.category,
    keywords: row.keywords,
    contentFormat: row.contentFormat,
    bodyMdx: row.bodyMdx,
    status: row.status,
    publishedAt: row.publishedAt,
    syncedAt: row.syncedAt,
  };
}

/** In-memory BlogStore mirroring the DB constraints (slug+locale unique, external_id unique). */
export class FakeBlogStore implements BlogStore {
  rows: FakeBlogRow[] = [];
  private nextId = 1;

  seed(row: Partial<FakeBlogRow> & { slug: string; locale: string }): FakeBlogRow {
    const full: FakeBlogRow = {
      id: this.nextId++,
      status: 'published',
      externalId: null,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
      title: 'Seeded post',
      description: null,
      category: null,
      keywords: null,
      contentFormat: 'html',
      bodyMdx: '<p>seeded</p>',
      syncedAt: new Date('2026-01-01T00:00:00Z'),
      ...row,
    };
    this.rows.push(full);
    return full;
  }

  async findByExternalId(externalId: string): Promise<BlogRowLite | null> {
    return this.rows.find((r) => r.externalId === externalId) ?? null;
  }

  async findBySlugLocale(slug: string, locale: string): Promise<BlogRowLite | null> {
    return this.rows.find((r) => r.slug === slug && r.locale === locale) ?? null;
  }

  async insertPost(input: PostclawBlogInsert): Promise<InsertPostResult> {
    if (this.rows.some((r) => r.externalId === input.externalId)) {
      return { ok: false, conflict: 'external_id' };
    }
    if (this.rows.some((r) => r.slug === input.slug && r.locale === input.locale)) {
      return { ok: false, conflict: 'slug' };
    }
    const row: FakeBlogRow = {
      id: this.nextId++,
      slug: input.slug,
      locale: input.locale,
      status: input.status,
      externalId: input.externalId,
      publishedAt: input.publishedAt,
      title: input.title,
      description: input.description,
      category: input.category,
      keywords: input.keywords,
      bodyMdx: input.bodyMdx as string,
      contentFormat: input.contentFormat,
      // Mirrors createDrizzleBlogStore: every write stamps a fresh synced_at.
      syncedAt: new Date(),
    };
    this.rows.push(row);
    return { ok: true, row };
  }

  async updateByExternalId(
    externalId: string,
    patch: PostclawBlogPatch,
  ): Promise<BlogRowLite | null> {
    const row = this.rows.find((r) => r.externalId === externalId);
    if (!row) return null;
    Object.assign(row, patch, { syncedAt: new Date() });
    return row;
  }

  async listForSync(opts: {
    cursor: { syncedAt: Date; id: number } | null;
    perPage: number;
    locale: string;
  }): Promise<BlogSyncRow[]> {
    const { cursor, perPage, locale } = opts;
    return this.rows
      .filter((r) => r.status === 'published')
      .filter((r) => locale === 'all' || r.locale === locale)
      .filter((r) => {
        if (!cursor) return true;
        const delta = r.syncedAt.getTime() - cursor.syncedAt.getTime();
        return delta !== 0 ? delta > 0 : r.id > cursor.id;
      })
      .sort((a, b) => a.syncedAt.getTime() - b.syncedAt.getTime() || a.id - b.id)
      .slice(0, perPage)
      .map(toSyncRow);
  }

  async findPublishedByExternalId(externalId: string): Promise<BlogSyncRow | null> {
    const row = this.rows.find((r) => r.externalId === externalId && r.status === 'published');
    return row ? toSyncRow(row) : null;
  }
}

export class FakeIdempotencyStore implements IdempotencyStore {
  entries = new Map<
    string,
    { requestSha256: string; statusCode: number | null; response: Record<string, unknown> | null }
  >();

  async reserve(key: string, requestSha256: string): Promise<ReserveResult> {
    const existing = this.entries.get(key);
    if (!existing) {
      this.entries.set(key, { requestSha256, statusCode: null, response: null });
      return { state: 'reserved' };
    }
    if (existing.requestSha256 !== requestSha256) return { state: 'mismatch' };
    if (existing.statusCode !== null && existing.response !== null) {
      return { state: 'replay', statusCode: existing.statusCode, response: existing.response };
    }
    return { state: 'in_flight' };
  }

  async complete(
    key: string,
    statusCode: number,
    response: Record<string, unknown>,
  ): Promise<void> {
    const entry = this.entries.get(key);
    if (entry) {
      entry.statusCode = statusCode;
      entry.response = response;
    }
  }

  async release(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (entry && entry.statusCode === null) this.entries.delete(key);
  }
}
