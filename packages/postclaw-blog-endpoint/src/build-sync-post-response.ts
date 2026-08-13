import type { BlogSyncRow, PostclawEndpointConfig } from './types';

/**
 * Shared by handle-list-posts.ts and handle-get-post.ts so both read
 * endpoints serialize a row identically. `id` in the response is the
 * PostClaw-facing identity — external_id, or null for MDX-authored rows,
 * which the content-sync crawl can still return (they have no external_id
 * but are still published content worth embedding). `row_id` exposes the
 * numeric serial id separately so a consumer never confuses the two.
 */
export function buildSyncPostResponse(
  config: PostclawEndpointConfig,
  row: BlogSyncRow,
): Record<string, unknown> {
  return {
    id: row.externalId,
    row_id: row.id,
    slug: row.slug,
    locale: row.locale,
    title: row.title,
    excerpt: row.description,
    content_format: row.contentFormat,
    content: row.bodyMdx,
    tags: row.keywords ?? [],
    categories: row.category ? [row.category] : [],
    status: row.status,
    published_at: row.publishedAt ? row.publishedAt.toISOString() : null,
    synced_at: row.syncedAt.toISOString(),
    url: `${config.siteBaseUrl.replace(/\/+$/, '')}/${row.locale}/blog/${row.slug}`,
  };
}
