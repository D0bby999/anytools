import { decodeBlogSyncCursor, encodeBlogSyncCursor } from '@anytools/db-shared';
import { buildSyncPostResponse } from './build-sync-post-response';
import type { BlogSyncCursor, HandlerResult, PostclawEndpointConfig } from './types';

export const DEFAULT_PER_PAGE = 50;
export const MAX_PER_PAGE = 100;

/** Parses `per_page`; null on any value outside [1, MAX_PER_PAGE] or non-integer text (caller 400s). */
export function parsePerPage(raw: string | null): number | null {
  if (raw === null) return DEFAULT_PER_PAGE;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (n < 1 || n > MAX_PER_PAGE) return null;
  return n;
}

/** `locale` defaults to 'en' (a 12-locale corpus would 12x embedding cost for near-duplicate content). */
export function parseLocale(raw: string | null): string {
  const trimmed = raw?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'en';
}

/** GET {base}/posts — keyset-paginated list of published posts for content sync (RAG). */
export async function handleListPosts(
  config: PostclawEndpointConfig,
  searchParams: URLSearchParams,
): Promise<HandlerResult> {
  const cursorRaw = searchParams.get('cursor');
  let cursor: BlogSyncCursor | null = null;
  if (cursorRaw !== null && cursorRaw !== '') {
    cursor = decodeBlogSyncCursor(cursorRaw);
    if (!cursor) return { status: 400, body: { error: 'Invalid cursor' } };
  }

  const perPage = parsePerPage(searchParams.get('per_page'));
  if (perPage === null) {
    return {
      status: 400,
      body: { error: `per_page must be an integer between 1 and ${MAX_PER_PAGE}` },
    };
  }

  const locale = parseLocale(searchParams.get('locale'));

  const rows = await config.blogStore.listForSync({ cursor, perPage, locale });
  const posts = rows.map((row) => buildSyncPostResponse(config, row));

  // A full page means "there may be more" — the consumer resumes from this
  // cursor and learns it's done when the next fetch returns fewer rows.
  // Deriving next_cursor from the LAST ROW RETURNED (not a consumer clock)
  // is what makes resumption immune to clock skew and frontmatter backdating.
  const lastRow = rows[rows.length - 1];
  const nextCursor =
    rows.length === perPage && lastRow
      ? encodeBlogSyncCursor({ syncedAt: lastRow.syncedAt, id: lastRow.id })
      : null;

  return { status: 200, body: { posts, next_cursor: nextCursor } };
}
