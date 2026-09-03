import { postclawHandlers } from '@/lib/postclaw-handlers';
import { IS_SELF_HOSTED, notFoundHandler } from '@/lib/self-hosted';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// See postclaw/health/route.ts for why this is wrapped rather than gated inline.
export const PATCH = IS_SELF_HOSTED ? notFoundHandler : postclawHandlers.updatePost;
export const GET = IS_SELF_HOSTED ? notFoundHandler : postclawHandlers.getPost;
