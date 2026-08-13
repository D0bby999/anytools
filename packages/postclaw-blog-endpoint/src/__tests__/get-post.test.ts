import { beforeEach, describe, expect, it } from 'vitest';
import { type TestContext, idCtx, makeContext, request } from './test-helpers';

let ctx: TestContext;
beforeEach(() => {
  ctx = makeContext();
});

describe('get post — auth', () => {
  it('401s without a bearer token (never 500)', async () => {
    const res = await ctx.handlers.getPost(
      new Request('https://example.test/api/postclaw/posts/x', { method: 'GET' }),
      idCtx('postclaw_abc'),
    );
    expect(res.status).toBe(401);
  });
});

describe('get post — published', () => {
  it('returns 200 with the full contract shape for a published post', async () => {
    ctx.blogStore.seed({
      slug: 'a-post',
      locale: 'en',
      externalId: 'postclaw_abc',
      title: 'A Post',
      description: 'excerpt',
      category: 'robotics',
      keywords: ['ai'],
      bodyMdx: '<p>body</p>',
      syncedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const res = await ctx.handlers.getPost(request('GET', null), idCtx('postclaw_abc'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: 'postclaw_abc',
      slug: 'a-post',
      locale: 'en',
      title: 'A Post',
      excerpt: 'excerpt',
      content_format: 'html',
      content: '<p>body</p>',
      tags: ['ai'],
      categories: ['robotics'],
      status: 'published',
      synced_at: '2026-01-01T00:00:00.000Z',
      url: 'https://besttoys.world/en/blog/a-post',
    });
    expect(typeof body.row_id).toBe('number');
  });
});

describe('get post — not found (draft AND unknown read identically)', () => {
  it('404s a draft post — never reveals that the id exists', async () => {
    ctx.blogStore.seed({
      slug: 'draft-post',
      locale: 'en',
      externalId: 'postclaw_draft',
      status: 'draft',
    });
    const res = await ctx.handlers.getPost(request('GET', null), idCtx('postclaw_draft'));
    expect(res.status).toBe(404);
  });

  it('404s an unknown external_id', async () => {
    const res = await ctx.handlers.getPost(request('GET', null), idCtx('postclaw_nope'));
    expect(res.status).toBe(404);
  });
});
