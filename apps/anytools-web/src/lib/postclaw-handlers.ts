import { BLOG_CATEGORIES } from '@/lib/load-blog-content';
import { SITE_URL } from '@/lib/site-url';
import { getDb } from '@anytools/db-shared/client';
import {
  createDrizzleBlogStore,
  createDrizzleIdempotencyStore,
  createPostclawHandlers,
} from '@anytools/postclaw-blog-endpoint';

type Handlers = ReturnType<typeof createPostclawHandlers>;

// Built lazily on first request, never at module load: getDb() throws when
// DATABASE_URL is unset, and `next build` imports every route module to read
// its exported config (runtime/dynamic) — an eager call here would fail the
// build on a machine without a DB configured. Routes are force-dynamic, so
// nothing calls these handlers during the build anyway.
let handlers: Handlers | undefined;

function getHandlers(): Handlers {
  if (!handlers) {
    const db = getDb();
    handlers = createPostclawHandlers({
      // Unset token → every request 401s (fail-closed) until the app's
      // Coolify env provisions POSTCLAW_BLOG_TOKEN.
      token: process.env.POSTCLAW_BLOG_TOKEN ?? '',
      siteBaseUrl: SITE_URL,
      allowedCategories: BLOG_CATEGORIES,
      blogStore: createDrizzleBlogStore(db),
      idempotencyStore: createDrizzleIdempotencyStore(db),
    });
  }
  return handlers;
}

export const postclawHandlers = {
  health: (req: Request) => getHandlers().health(req),
  createPost: (req: Request) => getHandlers().createPost(req),
  updatePost: (req: Request, ctx: { params: Promise<{ id: string }> }) =>
    getHandlers().updatePost(req, ctx),
  listPosts: (req: Request) => getHandlers().listPosts(req),
  getPost: (req: Request, ctx: { params: Promise<{ id: string }> }) =>
    getHandlers().getPost(req, ctx),
};
