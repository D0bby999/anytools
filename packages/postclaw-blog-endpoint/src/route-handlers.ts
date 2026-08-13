import { createHash } from 'node:crypto';
import { HEALTH_BODY, handleCreatePost, handleUpdatePost } from './handle-posts';
import type { HandlerResult, PostclawEndpointConfig } from './types';
import { verifyBearer, verifySignature } from './verify-bearer-and-hmac';

function json(result: HandlerResult): Response {
  return Response.json(result.body, { status: result.status });
}

const UNAUTHORIZED: HandlerResult = { status: 401, body: { error: 'Unauthorized' } };

/**
 * Wrap a mutating handler with idempotency semantics:
 * reserve → run → cache ONLY 2xx → release on anything else.
 * A missing Idempotency-Key header skips the store (curl/manual testing);
 * PostClaw always sends one.
 */
async function withIdempotency(
  config: PostclawEndpointConfig,
  idempotencyKey: string | null,
  rawBody: string,
  run: () => Promise<HandlerResult>,
): Promise<HandlerResult> {
  if (!idempotencyKey) return run();
  if (idempotencyKey.length > 200) {
    // varchar(200) cap — an overflow would 500 (retryable) forever; 400 is terminal.
    return { status: 400, body: { error: 'Idempotency-Key exceeds 200 characters' } };
  }

  const requestSha256 = createHash('sha256').update(rawBody, 'utf8').digest('hex');
  const reservation = await config.idempotencyStore.reserve(idempotencyKey, requestSha256);
  if (reservation.state === 'replay') {
    return { status: reservation.statusCode, body: reservation.response };
  }
  if (reservation.state === 'in_flight') {
    // A concurrent request with the same key is mid-flight; 429 is retried
    // later by PostClaw (unlike other 4xx, which are terminal).
    return { status: 429, body: { error: 'Request with this Idempotency-Key is in flight' } };
  }
  if (reservation.state === 'mismatch') {
    // Same key, different body — contract says reject, never silently apply:
    // replaying the old response here would silently drop the new content.
    return { status: 409, body: { error: 'Idempotency-Key reused with a different body' } };
  }

  let result: HandlerResult;
  try {
    result = await run();
  } catch (err) {
    // Never leave a dead reservation: PostClaw retries 5xx with the SAME key,
    // and an orphaned row would turn every retry into a 429 until staleness.
    await config.idempotencyStore.release(idempotencyKey);
    throw err;
  }
  if (result.status >= 200 && result.status < 300) {
    await config.idempotencyStore.complete(idempotencyKey, result.status, result.body);
  } else {
    await config.idempotencyStore.release(idempotencyKey);
  }
  return result;
}

/**
 * Next.js App Router handlers for the PostClaw custom_blog contract.
 * Wire-up per app:
 *   api/postclaw/health/route.ts     → export const GET = handlers.health
 *   api/postclaw/posts/route.ts      → export const POST = handlers.createPost
 *   api/postclaw/posts/[id]/route.ts → export const PATCH = handlers.updatePost
 */
export function createPostclawHandlers(config: PostclawEndpointConfig): {
  health: (req: Request) => Response;
  createPost: (req: Request) => Promise<Response>;
  updatePost: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
} {
  const authorized = (req: Request): boolean =>
    verifyBearer(req.headers.get('authorization'), config.token);

  const verifyMutating = (req: Request, rawBody: string): boolean =>
    authorized(req) &&
    verifySignature(req.headers.get('x-postclaw-signature'), rawBody, config.token);

  return {
    health: (req: Request): Response => {
      if (!authorized(req)) return json(UNAUTHORIZED);
      return Response.json(HEALTH_BODY, { status: 200 });
    },

    createPost: async (req: Request): Promise<Response> => {
      const rawBody = await req.text();
      if (!verifyMutating(req, rawBody)) return json(UNAUTHORIZED);
      const result = await withIdempotency(
        config,
        req.headers.get('idempotency-key'),
        rawBody,
        () => handleCreatePost(config, rawBody),
      );
      return json(result);
    },

    updatePost: async (
      req: Request,
      ctx: { params: Promise<{ id: string }> },
    ): Promise<Response> => {
      const rawBody = await req.text();
      if (!verifyMutating(req, rawBody)) return json(UNAUTHORIZED);
      const { id } = await ctx.params;
      const result = await withIdempotency(
        config,
        req.headers.get('idempotency-key'),
        rawBody,
        () => handleUpdatePost(config, id, rawBody),
      );
      return json(result);
    },
  };
}
