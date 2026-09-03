import { IS_SELF_HOSTED } from '@/lib/self-hosted';
// Type-only: the value import happens inside getHandler(), never at module top level.
// A top-level value import here would pull `better-auth/next-js` (and, transitively,
// its native better-sqlite3 binding) into every self-host request that touches this
// route module — even ones that 404 before ever calling getHandler().
import type { toNextJsHandler } from 'better-auth/next-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Lazy-load auth so the better-sqlite3 native binding isn't required during
// Next.js's build-time route config collection (where it can't be resolved).
let _handler: ReturnType<typeof toNextJsHandler> | null = null;
async function getHandler() {
  if (_handler) return _handler;
  const [{ auth }, { toNextJsHandler: buildHandler }] = await Promise.all([
    import('@/lib/auth'),
    import('better-auth/next-js'),
  ]);
  _handler = buildHandler(auth);
  return _handler;
}

export async function POST(req: Request) {
  // Gated before getHandler() so better-auth never initializes in self-host: no
  // BETTER_AUTH_SECRET is required, and no auth.db gets written.
  if (IS_SELF_HOSTED) return new Response(null, { status: 404 });
  const h = await getHandler();
  return h.POST(req);
}

export async function GET(req: Request) {
  if (IS_SELF_HOSTED) return new Response(null, { status: 404 });
  const h = await getHandler();
  return h.GET(req);
}
