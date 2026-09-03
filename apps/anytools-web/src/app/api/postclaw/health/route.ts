import { postclawHandlers } from '@/lib/postclaw-handlers';
import { IS_SELF_HOSTED } from '@/lib/self-hosted';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Re-exported trivially in hosted mode, so there is no function body to gate with an
// `if` — the postclaw distribution API only exists for the platform that owns the
// hosted site and has no meaning (and no DATABASE_URL to serve it from) in a stranger's
// self-host install.
const off = () => new Response(null, { status: 404 });

export const GET = IS_SELF_HOSTED ? off : postclawHandlers.health;
