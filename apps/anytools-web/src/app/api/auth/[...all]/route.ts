import { toNextJsHandler } from 'better-auth/next-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Lazy-load auth so the better-sqlite3 native binding isn't required during
// Next.js's build-time route config collection (where it can't be resolved).
let _handler: ReturnType<typeof toNextJsHandler> | null = null;
async function getHandler() {
  if (_handler) return _handler;
  const { auth } = await import('@/lib/auth');
  _handler = toNextJsHandler(auth);
  return _handler;
}

export async function POST(req: Request) {
  const h = await getHandler();
  return h.POST(req);
}

export async function GET(req: Request) {
  const h = await getHandler();
  return h.GET(req);
}
