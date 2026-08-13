import { postclawHandlers } from '@/lib/postclaw-handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = postclawHandlers.updatePost;
export const GET = postclawHandlers.getPost;
