import { sanitizePostHtml } from './sanitize-post-html';
import type { PostclawBlogInsert, PostclawBlogPatch, PostclawPostPayload } from './types';

export type ParseResult = { ok: true; payload: PostclawPostPayload } | { ok: false; error: string };

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Parse + shape-validate a POST/PATCH body. `requireCreateFields` = POST rules. */
export function parsePostclawPayload(rawBody: string, requireCreateFields: boolean): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: 'Body must be a JSON object' };
  }
  const p = data as Record<string, unknown>;

  if (requireCreateFields) {
    for (const field of ['title', 'content_html', 'external_id'] as const) {
      if (typeof p[field] !== 'string' || (p[field] as string).length === 0) {
        return { ok: false, error: `Missing required field: ${field}` };
      }
    }
  }
  for (const field of [
    'title',
    'content_html',
    'external_id',
    'excerpt',
    'slug',
    'cover_image_url',
    'canonical_url',
    'published_at',
  ] as const) {
    if (p[field] !== undefined && p[field] !== null && typeof p[field] !== 'string') {
      return { ok: false, error: `Field ${field} must be a string` };
    }
  }
  // Length caps matching the DB varchars: an overflow would throw 22001 → 500,
  // which PostClaw treats as retryable — a permanently failing retry loop.
  // Terminal 400s instead.
  for (const [field, max] of [
    ['title', 500],
    ['external_id', 128],
    ['slug', 255],
  ] as const) {
    const v = p[field];
    if (typeof v === 'string' && v.length > max) {
      return { ok: false, error: `Field ${field} exceeds ${max} characters` };
    }
  }
  for (const field of ['tags', 'categories'] as const) {
    if (p[field] !== undefined && p[field] !== null && !isStringArray(p[field])) {
      return { ok: false, error: `Field ${field} must be an array of strings` };
    }
  }
  if (p.status !== undefined && p.status !== 'draft' && p.status !== 'published') {
    return { ok: false, error: 'Field status must be "draft" or "published"' };
  }
  return { ok: true, payload: p as PostclawPostPayload };
}

export function slugifyTitle(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      // biome-ignore lint/suspicious/noMisleadingCharacterClass: stripping the combining-mark range AFTER NFKD decomposition is the intent - bare marks are exactly what remains to remove
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 200) || 'post'
  );
}

function textStats(html: string): { wordCount: number; readingTime: number } {
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const wordCount = text.length === 0 ? 0 : text.split(' ').length;
  return { wordCount, readingTime: Math.max(1, Math.ceil(wordCount / 250)) };
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function mapPayloadToBlogInsert(
  payload: PostclawPostPayload,
  opts: { locale: string; allowedCategories?: readonly string[] },
): PostclawBlogInsert {
  const bodyMdx = sanitizePostHtml(payload.content_html);
  const { wordCount, readingTime } = textStats(bodyMdx);
  const status = payload.status ?? 'published';
  const rawCategory = payload.categories?.[0]?.trim() || null;
  // Closed per-site category unions feed keyed lookups (category-photos etc.) —
  // free text from the composer must map to null, never a novel value.
  const category =
    rawCategory && opts.allowedCategories?.includes(rawCategory) ? rawCategory : null;

  const frontmatter: Record<string, unknown> = {
    title: payload.title,
    ...(payload.excerpt ? { description: payload.excerpt } : {}),
    ...(payload.tags?.length ? { keywords: payload.tags } : {}),
    ...(payload.canonical_url ? { canonicalUrl: payload.canonical_url } : {}),
    ...(payload.cover_image_url
      ? {
          heroImage: {
            url: payload.cover_image_url,
            alt: payload.title,
            credit: { photographer: 'PostClaw', kind: 'ai', source_label: 'PostClaw' },
          },
        }
      : {}),
  };

  // A provided slug is arbitrary composer text — normalize it through the same
  // slugifier so "Weird Stuff/x" can't become an unreachable route.
  const providedSlug = payload.slug?.trim();
  return {
    slug: providedSlug ? slugifyTitle(providedSlug) : slugifyTitle(payload.title),
    locale: opts.locale,
    title: payload.title,
    description: payload.excerpt ?? null,
    category,
    keywords: payload.tags ?? null,
    frontmatter,
    bodyMdx,
    wordCount,
    readingTime,
    contentFormat: 'html',
    externalId: payload.external_id,
    status,
    // EN blog index orders publishedAt DESC = NULLS FIRST in Postgres: a
    // null-dated published row would pin above every fresh post forever.
    publishedAt: parseDate(payload.published_at) ?? (status === 'published' ? new Date() : null),
  };
}

/** PATCH semantics: only provided fields change; content_html re-derives content fields. */
export function mapPayloadToBlogPatch(payload: PostclawPostPayload): PostclawBlogPatch {
  const patch: PostclawBlogPatch = {};
  if (payload.title) patch.title = payload.title;
  if (payload.excerpt !== undefined) patch.description = payload.excerpt ?? null;
  if (payload.tags !== undefined) patch.keywords = payload.tags ?? null;
  if (payload.status) patch.status = payload.status;
  // publishedAt changes ONLY when explicitly sent. PostClaw's PATCH always
  // includes status:"published" and usually omits published_at — defaulting to
  // now() here would reset the publish date on every routine edit (index-order
  // churn + date manipulation in Google's eyes). The null-backfill for a
  // draft→publish transition happens in the handler, where the row is known.
  if (payload.published_at) patch.publishedAt = parseDate(payload.published_at);
  if (payload.content_html) {
    const bodyMdx = sanitizePostHtml(payload.content_html);
    const stats = textStats(bodyMdx);
    patch.bodyMdx = bodyMdx;
    patch.wordCount = stats.wordCount;
    patch.readingTime = stats.readingTime;
    // A PATCH always writes HTML — never leave a row claiming mdx with an HTML body.
    patch.contentFormat = 'html';
  }
  return patch;
}
