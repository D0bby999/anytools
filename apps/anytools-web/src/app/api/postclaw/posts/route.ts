import { postclawHandlers } from '@/lib/postclaw-handlers';
import { IS_SELF_HOSTED, notFoundHandler } from '@/lib/self-hosted';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// See postclaw/health/route.ts for why this is wrapped rather than gated inline.
export const POST = IS_SELF_HOSTED ? notFoundHandler : postclawHandlers.createPost;
export const GET = IS_SELF_HOSTED ? notFoundHandler : postclawHandlers.listPosts;
