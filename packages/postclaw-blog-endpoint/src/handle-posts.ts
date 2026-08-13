import {
  mapPayloadToBlogInsert,
  mapPayloadToBlogPatch,
  parsePostclawPayload,
} from './map-postclaw-payload';
import type { BlogRowLite, HandlerResult, PostclawEndpointConfig } from './types';

export const HEALTH_BODY = { service: 'postclaw-custom-blog', version: 1 } as const;

function postUrl(
  config: PostclawEndpointConfig,
  row: Pick<BlogRowLite, 'slug' | 'locale'>,
): string {
  return `${config.siteBaseUrl.replace(/\/+$/, '')}/${row.locale}/blog/${row.slug}`;
}

function postResponse(
  config: PostclawEndpointConfig,
  status: number,
  row: Pick<BlogRowLite, 'slug' | 'locale' | 'status' | 'externalId'>,
): HandlerResult {
  // The contract's `id` is what PostClaw stores and later PATCHes with. Using
  // external_id (not the serial row id) makes the identity immune to row-id
  // churn AND makes it impossible for a PATCH to address an MDX-authored row.
  return {
    status,
    body: { id: row.externalId ?? '', url: postUrl(config, row), status: row.status },
  };
}

/** POST {base}/posts — create (or replay-safe re-create) a post. */
export async function handleCreatePost(
  config: PostclawEndpointConfig,
  rawBody: string,
): Promise<HandlerResult> {
  const parsed = parsePostclawPayload(rawBody, true);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const payload = parsed.payload;
  const locale = config.locale ?? 'en';

  // Resource identity wins over the replay cache: a re-sent create for an
  // existing external_id returns the existing post (reference-impl behavior).
  const existing = await config.blogStore.findByExternalId(payload.external_id);
  if (existing) return postResponse(config, 201, existing);

  const input = mapPayloadToBlogInsert(payload, {
    locale,
    allowedCategories: config.allowedCategories,
  });

  // Slug collision with a different post (MDX-authored or another PostClaw
  // post) is a duplicate-topic error. 4xx is terminal in the contract (no
  // retry), which is exactly right: fail loudly, never silently suffix — a
  // near-duplicate URL going live is what the slug dedup system exists to block.
  const slugOwner = await config.blogStore.findBySlugLocale(input.slug, locale);
  if (slugOwner && slugOwner.externalId !== payload.external_id) {
    return {
      status: 422,
      body: {
        error: `slug "${input.slug}" already exists for locale ${locale} (owned by ${slugOwner.externalId ? 'another PostClaw post' : 'an MDX-authored post'}) — pick a different slug`,
      },
    };
  }

  const result = await config.blogStore.insertPost(input);
  if (!result.ok) {
    if (result.conflict === 'external_id') {
      // Concurrent duplicate create lost the insert race — return the winner.
      const winner = await config.blogStore.findByExternalId(payload.external_id);
      if (winner) return postResponse(config, 201, winner);
      return { status: 500, body: { error: 'conflict resolution failed' } };
    }
    return {
      status: 422,
      body: { error: `slug "${input.slug}" already exists for locale ${locale}` },
    };
  }
  return postResponse(config, 201, result.row);
}

/** PATCH {base}/posts/{id} — id is the external_id we returned at create time. */
export async function handleUpdatePost(
  config: PostclawEndpointConfig,
  externalId: string,
  rawBody: string,
): Promise<HandlerResult> {
  const parsed = parsePostclawPayload(rawBody, false);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };

  // Lookup strictly by external_id: rows with externalId NULL are MDX-authored
  // and structurally unreachable from this endpoint — a leaked token cannot
  // rewrite affiliate content, and a buggy remote id simply 404s.
  const patch = mapPayloadToBlogPatch(parsed.payload);
  let updated = await config.blogStore.updateByExternalId(externalId, patch);
  if (!updated) return { status: 404, body: { error: 'Post not found' } };

  // Backfill ONLY a null date (draft→publish with no explicit published_at):
  // the EN index sorts publishedAt DESC = NULLS FIRST, so a null-dated
  // published row would pin to the top. An existing date is never touched —
  // PostClaw sends status:"published" on every routine edit.
  if (updated.status === 'published' && updated.publishedAt === null) {
    updated =
      (await config.blogStore.updateByExternalId(externalId, { publishedAt: new Date() })) ??
      updated;
  }
  return postResponse(config, 200, updated);
}
