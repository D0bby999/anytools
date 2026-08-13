import { beforeEach, describe, expect, it } from 'vitest';
import {
  CREATE_PAYLOAD,
  type TestContext,
  makeContext,
  patchCtx,
  request,
  sign,
  signedPatch,
  signedPost,
} from './test-helpers';

let ctx: TestContext;
beforeEach(() => {
  ctx = makeContext();
});

describe('health', () => {
  it('returns the exact contract body when authorized', async () => {
    const res = ctx.handlers.health(request('GET', null));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ service: 'postclaw-custom-blog', version: 1 });
  });

  it('401s without or with wrong-length token (never 500)', async () => {
    expect(ctx.handlers.health(new Request('https://x.test', { method: 'GET' })).status).toBe(401);
    const wrongLength = request('GET', null, { authorization: 'Bearer short' });
    expect(ctx.handlers.health(wrongLength).status).toBe(401);
  });
});

describe('auth on mutating requests', () => {
  it('401s a POST with a MISSING signature (signature is required, not optional)', async () => {
    const body = JSON.stringify(CREATE_PAYLOAD);
    const res = await ctx.handlers.createPost(request('POST', body));
    expect(res.status).toBe(401);
    expect(ctx.blogStore.rows).toHaveLength(0);
  });

  it('401s on tampered body and on wrong-length signature', async () => {
    const body = JSON.stringify(CREATE_PAYLOAD);
    const tampered = request('POST', body, { 'x-postclaw-signature': sign('other-bytes') });
    expect((await ctx.handlers.createPost(tampered)).status).toBe(401);
    const short = request('POST', body, { 'x-postclaw-signature': 'sha256=abc' });
    expect((await ctx.handlers.createPost(short)).status).toBe(401);
  });
});

describe('create', () => {
  it('creates a post and responds with external_id as id', async () => {
    const res = await ctx.handlers.createPost(signedPost(CREATE_PAYLOAD, 'postclaw_k1'));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe('postclaw_11111111-aaaa');
    expect(body.url).toBe('https://besttoys.world/en/blog/ai-is-reshaping-social-media');
    expect(body.status).toBe('published');
    expect(ctx.blogStore.rows[0]?.contentFormat).toBe('html');
  });

  it('400s on missing required fields and on over-length fields (terminal, not retried)', async () => {
    expect((await ctx.handlers.createPost(signedPost({ title: 'x' }))).status).toBe(400);
    const longExternalId = { ...CREATE_PAYLOAD, external_id: 'postclaw_'.padEnd(200, 'x') };
    expect((await ctx.handlers.createPost(signedPost(longExternalId))).status).toBe(400);
  });

  it('returns the existing post (201) for a re-create of the same external_id with a new key', async () => {
    await ctx.handlers.createPost(signedPost(CREATE_PAYLOAD, 'postclaw_k1'));
    const res = await ctx.handlers.createPost(signedPost(CREATE_PAYLOAD, 'postclaw_k2'));
    expect(res.status).toBe(201);
    expect(ctx.blogStore.rows).toHaveLength(1);
  });

  it('422s a slug collision with an MDX-authored row instead of suffixing', async () => {
    ctx.blogStore.seed({ slug: 'ai-is-reshaping-social-media', locale: 'en' });
    const res = await ctx.handlers.createPost(signedPost(CREATE_PAYLOAD, 'postclaw_k1'));
    expect(res.status).toBe(422);
    expect(ctx.blogStore.rows).toHaveLength(1);
  });

  it('nulls categories outside the site union, keeps ones inside it', async () => {
    await ctx.handlers.createPost(
      signedPost({ ...CREATE_PAYLOAD, categories: ['not-a-real-category'] }, 'postclaw_k1'),
    );
    expect(ctx.blogStore.rows[0]?.category).toBeNull();
    await ctx.handlers.createPost(
      signedPost(
        {
          ...CREATE_PAYLOAD,
          external_id: 'postclaw_2',
          slug: 'other-slug',
          categories: ['robotics'],
        },
        'postclaw_k2',
      ),
    );
    expect(ctx.blogStore.rows[1]?.category).toBe('robotics');
  });

  it('defaults publishedAt to now() for published posts and normalizes provided slugs', async () => {
    const res = await ctx.handlers.createPost(
      signedPost({ ...CREATE_PAYLOAD, slug: 'Weird Stuff/x' }, 'postclaw_k1'),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).url).toBe('https://besttoys.world/en/blog/weird-stuff-x');
    expect(ctx.blogStore.rows[0]?.publishedAt).toBeInstanceOf(Date);
  });
});

describe('update', () => {
  it('PATCHes by external_id, sets contentFormat html, PRESERVES the original publishedAt', async () => {
    await ctx.handlers.createPost(signedPost(CREATE_PAYLOAD, 'postclaw_k1'));
    const originalDate = ctx.blogStore.rows[0]?.publishedAt;
    expect(originalDate).toBeInstanceOf(Date);

    // PostClaw's PATCH always sends status:"published" and usually omits
    // published_at — that routine edit must NOT reset the publish date.
    const res = await ctx.handlers.updatePost(
      signedPatch({ content_html: '<p>new</p>', status: 'published' }),
      patchCtx('postclaw_11111111-aaaa'),
    );
    expect(res.status).toBe(200);
    expect(ctx.blogStore.rows[0]?.bodyMdx).toContain('new');
    expect(ctx.blogStore.rows[0]?.contentFormat).toBe('html');
    expect(ctx.blogStore.rows[0]?.publishedAt).toBe(originalDate);
  });

  it('backfills publishedAt ONLY when a draft is published without a date (NULLS FIRST guard)', async () => {
    await ctx.handlers.createPost(
      signedPost({ ...CREATE_PAYLOAD, status: 'draft' }, 'postclaw_k1'),
    );
    expect(ctx.blogStore.rows[0]?.publishedAt).toBeNull();
    const res = await ctx.handlers.updatePost(
      signedPatch({ status: 'published' }),
      patchCtx('postclaw_11111111-aaaa'),
    );
    expect(res.status).toBe(200);
    expect(ctx.blogStore.rows[0]?.publishedAt).toBeInstanceOf(Date);
  });

  it('404s an unknown external_id AND structurally cannot touch MDX-authored rows', async () => {
    const mdxRow = ctx.blogStore.seed({ slug: 'affiliate-money-post', locale: 'en' });
    const res = await ctx.handlers.updatePost(
      signedPatch({ title: 'pwn' }),
      patchCtx(String(mdxRow.id)), // numeric row id — the old attack vector
    );
    expect(res.status).toBe(404);
    const res2 = await ctx.handlers.updatePost(
      signedPatch({ title: 'x' }),
      patchCtx('postclaw_nope'),
    );
    expect(res2.status).toBe(404);
  });
});

describe('sanitizer (through create)', () => {
  it('strips scripts, event handlers, javascript: hrefs; nofollows anchors', async () => {
    const res = await ctx.handlers.createPost(
      signedPost(
        {
          ...CREATE_PAYLOAD,
          content_html:
            '<p onclick="x()">ok</p><script>evil()</script><a href="javascript:alert(1)">j</a><a href="https://ex.com">k</a><img src="http://insecure.com/x.png">',
        },
        'postclaw_k1',
      ),
    );
    expect(res.status).toBe(201);
    const html = ctx.blogStore.rows[0]?.bodyMdx ?? '';
    expect(html).not.toContain('script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('insecure.com');
    expect(html).toContain('rel="nofollow ugc noopener"');
    expect(html).toContain('https://ex.com');
  });
});
