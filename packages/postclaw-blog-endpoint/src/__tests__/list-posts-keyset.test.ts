import { beforeEach, describe, expect, it } from 'vitest';
import { type TestContext, listRequest, makeContext } from './test-helpers';

let ctx: TestContext;
beforeEach(() => {
  ctx = makeContext();
});

describe('list posts — keyset cursor pagination', () => {
  it('crawls the full corpus in synced_at ASC, id ASC order across multiple pages', async () => {
    ctx.blogStore.seed({ slug: 'p1', locale: 'en', syncedAt: new Date('2026-01-01T00:00:00Z') });
    ctx.blogStore.seed({ slug: 'p2', locale: 'en', syncedAt: new Date('2026-01-01T00:00:01Z') });
    ctx.blogStore.seed({ slug: 'p3', locale: 'en', syncedAt: new Date('2026-01-01T00:00:02Z') });

    const page1 = await (await ctx.handlers.listPosts(listRequest('?per_page=2'))).json();
    expect(page1.posts.map((p: { slug: string }) => p.slug)).toEqual(['p1', 'p2']);
    expect(page1.next_cursor).not.toBeNull();

    const page2 = await (
      await ctx.handlers.listPosts(listRequest(`?per_page=2&cursor=${page1.next_cursor}`))
    ).json();
    expect(page2.posts.map((p: { slug: string }) => p.slug)).toEqual(['p3']);
    // Short of a full page — this IS the end of the corpus.
    expect(page2.next_cursor).toBeNull();
  });

  it('a full-page response always sets next_cursor, even when it happens to be the last page', async () => {
    ctx.blogStore.seed({ slug: 'p1', locale: 'en', syncedAt: new Date('2026-01-01T00:00:00Z') });
    ctx.blogStore.seed({ slug: 'p2', locale: 'en', syncedAt: new Date('2026-01-01T00:00:01Z') });

    const page1 = await (await ctx.handlers.listPosts(listRequest('?per_page=2'))).json();
    expect(page1.posts).toHaveLength(2);
    expect(page1.next_cursor).not.toBeNull();

    // The consumer resumes and learns it's done only when the next fetch is short.
    const page2 = await (
      await ctx.handlers.listPosts(listRequest(`?per_page=2&cursor=${page1.next_cursor}`))
    ).json();
    expect(page2.posts).toHaveLength(0);
    expect(page2.next_cursor).toBeNull();
  });

  it('a mid-crawl publish with a fresh synced_at is never skipped, even between already-crawled pages', async () => {
    ctx.blogStore.seed({ slug: 'first', locale: 'en', syncedAt: new Date('2026-01-01T00:00:00Z') });
    ctx.blogStore.seed({ slug: 'last', locale: 'en', syncedAt: new Date('2026-01-01T00:00:30Z') });

    // Consumer crawls page 1 and gets only 'first'.
    const page1 = await (await ctx.handlers.listPosts(listRequest('?per_page=1'))).json();
    expect(page1.posts.map((p: { slug: string }) => p.slug)).toEqual(['first']);

    // A /do publish lands BETWEEN the two rows' timestamps, after page 1 was
    // already returned to the consumer.
    ctx.blogStore.seed({
      slug: 'mid-crawl',
      locale: 'en',
      syncedAt: new Date('2026-01-01T00:00:15Z'),
    });

    // Resuming from the server-issued cursor must surface the new row before
    // 'last' — never skip it because the consumer's own clock disagrees.
    const page2 = await (
      await ctx.handlers.listPosts(listRequest(`?per_page=1&cursor=${page1.next_cursor}`))
    ).json();
    expect(page2.posts.map((p: { slug: string }) => p.slug)).toEqual(['mid-crawl']);

    const page3 = await (
      await ctx.handlers.listPosts(listRequest(`?per_page=1&cursor=${page2.next_cursor}`))
    ).json();
    expect(page3.posts.map((p: { slug: string }) => p.slug)).toEqual(['last']);
    // A full page (1 row === per_page) still sets next_cursor; the "this IS
    // the end" signal is a subsequent short page, covered separately below.
    expect(page3.next_cursor).not.toBeNull();
  });

  it('id tiebreaks rows sharing an identical synced_at', async () => {
    const t = new Date('2026-01-01T00:00:00Z');
    ctx.blogStore.seed({ slug: 'p-a', locale: 'en', syncedAt: t });
    ctx.blogStore.seed({ slug: 'p-b', locale: 'en', syncedAt: t });

    const page1 = await (await ctx.handlers.listPosts(listRequest('?per_page=1'))).json();
    expect(page1.posts[0].slug).toBe('p-a');

    const page2 = await (
      await ctx.handlers.listPosts(listRequest(`?per_page=1&cursor=${page1.next_cursor}`))
    ).json();
    expect(page2.posts[0].slug).toBe('p-b');
  });
});
