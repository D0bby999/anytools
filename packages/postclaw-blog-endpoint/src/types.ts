import type { BlogContentFormat, BlogStatus } from '@anytools/db-shared';
import type { SanitizedHtml } from './sanitize-post-html';

/** Request body of POST {base}/posts and PATCH {base}/posts/{id} (custom_blog contract). */
export type PostclawPostPayload = {
  title: string;
  content_html: string;
  external_id: string;
  excerpt?: string | null;
  slug?: string | null;
  tags?: string[] | null;
  categories?: string[] | null;
  cover_image_url?: string | null;
  canonical_url?: string | null;
  status?: 'draft' | 'published';
  published_at?: string | null;
};

/** The subset of a blogs row the handlers read back. */
export type BlogRowLite = {
  id: number;
  slug: string;
  locale: string;
  status: BlogStatus;
  externalId: string | null;
  publishedAt: Date | null;
};

/** Insert input produced by map-postclaw-payload (bodyMdx holds sanitized HTML). */
export type PostclawBlogInsert = {
  slug: string;
  locale: string;
  title: string;
  description: string | null;
  category: string | null;
  keywords: string[] | null;
  frontmatter: Record<string, unknown>;
  bodyMdx: SanitizedHtml;
  wordCount: number;
  readingTime: number;
  contentFormat: BlogContentFormat;
  externalId: string;
  status: BlogStatus;
  publishedAt: Date | null;
};

/** Patch applied by PATCH /posts/{id}; content fields re-derived when content_html present. */
export type PostclawBlogPatch = Partial<
  Pick<
    PostclawBlogInsert,
    | 'title'
    | 'description'
    | 'keywords'
    | 'bodyMdx'
    | 'wordCount'
    | 'readingTime'
    | 'contentFormat'
    | 'status'
    | 'publishedAt'
  >
>;

export type InsertPostResult =
  | { ok: true; row: BlogRowLite }
  | { ok: false; conflict: 'external_id' | 'slug' };

export interface BlogStore {
  findByExternalId(externalId: string): Promise<BlogRowLite | null>;
  findBySlugLocale(slug: string, locale: string): Promise<BlogRowLite | null>;
  insertPost(input: PostclawBlogInsert): Promise<InsertPostResult>;
  /** Returns the updated row, or null when no row has this externalId. */
  updateByExternalId(externalId: string, patch: PostclawBlogPatch): Promise<BlogRowLite | null>;
}

export type ReserveResult =
  | { state: 'reserved' }
  | { state: 'replay'; statusCode: number; response: Record<string, unknown> }
  | { state: 'in_flight' }
  | { state: 'mismatch' };

export interface IdempotencyStore {
  /**
   * Atomically claim `key` for a request whose raw body hashes to `requestSha256`.
   * A pre-existing key with a cached response replays (same sha) or rejects
   * (different sha → mismatch/409). A response-less row younger than the
   * staleness window is a concurrent in-flight request; older ones are taken
   * over (crashed owner).
   */
  reserve(key: string, requestSha256: string): Promise<ReserveResult>;
  /** Cache a response for replay. Callers only pass 2xx — a cached 5xx/429 would poison the key. */
  complete(key: string, statusCode: number, response: Record<string, unknown>): Promise<void>;
  /** Drop an unfinished reservation so a retry can re-attempt after a non-2xx outcome. */
  release(key: string): Promise<void>;
}

export type PostclawEndpointConfig = {
  /** Bearer token = auth credential AND HMAC signing key (contract design). */
  token: string;
  /** e.g. https://besttoys.world — used to build post URLs in responses. */
  siteBaseUrl: string;
  /** Locale PostClaw posts land in. Default 'en'. */
  locale?: string;
  /** Site's closed category union; payload categories outside it map to null. */
  allowedCategories?: readonly string[];
  blogStore: BlogStore;
  idempotencyStore: IdempotencyStore;
};

export type HandlerResult = { status: number; body: Record<string, unknown> };
