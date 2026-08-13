import { beforeEach, describe, expect, it } from 'vitest';
import { FakeBlogStore } from './fakes';
import { CREATE_PAYLOAD, type TestContext, makeContext, signedPost } from './test-helpers';

let ctx: TestContext;
beforeEach(() => {
  ctx = makeContext();
});

describe('idempotency replay cache', () => {
  it('replays the cached 201 for the same Idempotency-Key + body, without a duplicate row', async () => {
    const first = await ctx.handlers.createPost(signedPost(CREATE_PAYLOAD, 'postclaw_k1'));
    const replay = await ctx.handlers.createPost(signedPost(CREATE_PAYLOAD, 'postclaw_k1'));
    expect(replay.status).toBe(201);
    expect(await replay.json()).toEqual(await first.json());
    expect(ctx.blogStore.rows).toHaveLength(1);
  });

  it('409s the same Idempotency-Key with a DIFFERENT body (never silently applies)', async () => {
    await ctx.handlers.createPost(signedPost(CREATE_PAYLOAD, 'postclaw_k1'));
    const res = await ctx.handlers.createPost(
      signedPost({ ...CREATE_PAYLOAD, title: 'Changed' }, 'postclaw_k1'),
    );
    expect(res.status).toBe(409);
  });

  it('400s an over-length Idempotency-Key instead of 500ing on varchar overflow', async () => {
    const res = await ctx.handlers.createPost(signedPost(CREATE_PAYLOAD, 'k'.repeat(201)));
    expect(res.status).toBe(400);
  });

  it('does NOT cache non-2xx responses — a retry after a failure can succeed', async () => {
    ctx.blogStore.seed({ slug: 'ai-is-reshaping-social-media', locale: 'en' });
    const fail = await ctx.handlers.createPost(signedPost(CREATE_PAYLOAD, 'postclaw_k1'));
    expect(fail.status).toBe(422);
    ctx.blogStore.rows = []; // operator resolves the collision
    const retry = await ctx.handlers.createPost(signedPost(CREATE_PAYLOAD, 'postclaw_k1'));
    expect(retry.status).toBe(201);
  });

  it('releases the reservation when the handler THROWS — the retry is not poisoned', async () => {
    const store = new FakeBlogStore();
    const original = store.findByExternalId.bind(store);
    let failures = 0;
    store.findByExternalId = async (id: string) => {
      if (failures++ === 0) throw new Error('transient db outage');
      return original(id);
    };
    const throwingCtx = makeContext({ blogStore: store });

    // First attempt crashes (Next would 500 → PostClaw retries with the SAME key).
    await expect(
      throwingCtx.handlers.createPost(signedPost(CREATE_PAYLOAD, 'postclaw_k1')),
    ).rejects.toThrow('transient db outage');

    // The retry must find the key free (released), not an in-flight 429 or cached 500.
    const retry = await throwingCtx.handlers.createPost(signedPost(CREATE_PAYLOAD, 'postclaw_k1'));
    expect(retry.status).toBe(201);
    expect(store.rows).toHaveLength(1);
  });
});

describe('concurrency', () => {
  it('two parallel identical POSTs produce one row and no 5xx', async () => {
    const [a, b] = await Promise.all([
      ctx.handlers.createPost(signedPost(CREATE_PAYLOAD, 'postclaw_k1')),
      ctx.handlers.createPost(signedPost(CREATE_PAYLOAD, 'postclaw_k1')),
    ]);
    const statuses = [a.status, b.status].sort();
    // One wins (201); the loser sees in-flight (429, retryable) or the replay (201).
    expect([201, 429]).toContain(statuses[1]);
    expect(statuses[0]).toBe(201);
    expect(ctx.blogStore.rows).toHaveLength(1);
  });

  it('two parallel creates with DIFFERENT keys but same external_id converge on one row', async () => {
    const [a, b] = await Promise.all([
      ctx.handlers.createPost(signedPost(CREATE_PAYLOAD, 'postclaw_k1')),
      ctx.handlers.createPost(signedPost({ ...CREATE_PAYLOAD }, 'postclaw_k2')),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(ctx.blogStore.rows).toHaveLength(1);
  });
});
