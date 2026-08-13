import type {
  BlogRowLite,
  BlogStore,
  IdempotencyStore,
  InsertPostResult,
  PostclawBlogInsert,
  PostclawBlogPatch,
  ReserveResult,
} from '../types';

/** In-memory BlogStore mirroring the DB constraints (slug+locale unique, external_id unique). */
export class FakeBlogStore implements BlogStore {
  rows: (BlogRowLite & { bodyMdx?: string; contentFormat?: string; category?: string | null })[] =
    [];
  private nextId = 1;

  seed(row: Partial<BlogRowLite> & { slug: string; locale: string }): BlogRowLite {
    const full: BlogRowLite = {
      id: this.nextId++,
      status: 'published',
      externalId: null,
      publishedAt: new Date('2026-01-01T00:00:00Z'),
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
    const row = {
      id: this.nextId++,
      slug: input.slug,
      locale: input.locale,
      status: input.status,
      externalId: input.externalId,
      publishedAt: input.publishedAt,
      bodyMdx: input.bodyMdx as string,
      contentFormat: input.contentFormat,
      category: input.category,
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
    Object.assign(row, patch);
    return row;
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
