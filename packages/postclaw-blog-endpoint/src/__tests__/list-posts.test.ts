import { beforeEach, describe, expect, it } from 'vitest';
import { type TestContext, listRequest, makeContext } from './test-helpers';

let ctx: TestContext;
beforeEach(() => {
  ctx = makeContext();
});

describe('list posts — auth', () => {
  it('401s without a bearer token (never 500)', async () => {
    const res = await ctx.handlers.listPosts(
      new Request('https://example.test/api/postclaw/posts', { method: 'GET' }),
    );
    expect(res.status).toBe(401);
  });
});

describe('list posts — empty and shape', () => {
  it('returns an empty page with next_cursor null when nothing is published', async () => {
    const res = await ctx.handlers.listPosts(listRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ posts: [], next_cursor: null });
  });

  it('serializes every contract field, using external_id as id and exposing row_id separately', async () => {
    const row = ctx.blogStore.seed({
      slug: 'a-post',
      locale: 'en',
      externalId: 'postclaw_abc',
      title: 'A Post',
      description: 'An excerpt',
      category: 'stem-kits',
      keywords: ['ai', 'toys'],
      bodyMdx: '<p>verbatim body</p>',
      syncedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const res = await ctx.handlers.listPosts(listRequest());
    const body = await res.json();
    expect(body.posts).toEqual([
      {
        id: 'postclaw_abc',
        row_id: row.id,
        slug: 'a-post',
        locale: 'en',
        title: 'A Post',
        excerpt: 'An excerpt',
        content_format: 'html',
        content: '<p>verbatim body</p>',
        tags: ['ai', 'toys'],
        categories: ['stem-kits'],
        status: 'published',
        published_at: row.publishedAt?.toISOString(),
        synced_at: '2026-01-01T00:00:00.000Z',
        url: 'https://besttoys.world/en/blog/a-post',
      },
    ]);
  });

  it('exposes id: null for MDX-authored rows (no external_id) instead of dropping them', async () => {
    ctx.blogStore.seed({ slug: 'mdx-post', locale: 'en', externalId: null });
    const body = await (await ctx.handlers.listPosts(listRequest())).json();
    expect(body.posts[0].id).toBeNull();
  });
});

describe('list posts — draft exclusion', () => {
  it('excludes drafts from the list entirely', async () => {
    ctx.blogStore.seed({ slug: 'draft-post', locale: 'en', status: 'draft' });
    ctx.blogStore.seed({ slug: 'live-post', locale: 'en', status: 'published' });
    const body = await (await ctx.handlers.listPosts(listRequest())).json();
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].slug).toBe('live-post');
  });
});

describe('list posts — locale filter', () => {
  it('defaults to locale=en and excludes other locales', async () => {
    ctx.blogStore.seed({ slug: 'p', locale: 'en' });
    ctx.blogStore.seed({ slug: 'p', locale: 'vi' });
    const body = await (await ctx.handlers.listPosts(listRequest())).json();
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].locale).toBe('en');
  });

  it('locale=all returns every locale; a specific non-default locale returns only that one', async () => {
    ctx.blogStore.seed({ slug: 'p', locale: 'en' });
    ctx.blogStore.seed({ slug: 'p', locale: 'vi' });
    const all = await (await ctx.handlers.listPosts(listRequest('?locale=all'))).json();
    expect(all.posts).toHaveLength(2);
    const vi = await (await ctx.handlers.listPosts(listRequest('?locale=vi'))).json();
    expect(vi.posts).toHaveLength(1);
    expect(vi.posts[0].locale).toBe('vi');
  });
});

describe('list posts — per_page validation', () => {
  it('400s per_page above the 100 cap, zero, and non-numeric values (terminal, not 500)', async () => {
    expect((await ctx.handlers.listPosts(listRequest('?per_page=101'))).status).toBe(400);
    expect((await ctx.handlers.listPosts(listRequest('?per_page=0'))).status).toBe(400);
    expect((await ctx.handlers.listPosts(listRequest('?per_page=abc'))).status).toBe(400);
  });

  it('400s a malformed cursor instead of 500ing', async () => {
    expect((await ctx.handlers.listPosts(listRequest('?cursor=not-a-cursor'))).status).toBe(400);
    expect(
      (await ctx.handlers.listPosts(listRequest('?cursor=2026-01-01T00:00:00Z.notanid'))).status,
    ).toBe(400);
  });
});
