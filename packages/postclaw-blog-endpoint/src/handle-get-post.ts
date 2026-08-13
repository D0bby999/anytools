import { buildSyncPostResponse } from './build-sync-post-response';
import type { HandlerResult, PostclawEndpointConfig } from './types';

/**
 * GET {base}/posts/{external_id} — single post for content sync (RAG).
 * `status='published'` is explicit and terminal: a draft row reads exactly
 * like an unknown id (404), never revealing that the id exists.
 */
export async function handleGetPost(
  config: PostclawEndpointConfig,
  externalId: string,
): Promise<HandlerResult> {
  const row = await config.blogStore.findPublishedByExternalId(externalId);
  if (!row) return { status: 404, body: { error: 'Post not found' } };
  return { status: 200, body: buildSyncPostResponse(config, row) };
}
