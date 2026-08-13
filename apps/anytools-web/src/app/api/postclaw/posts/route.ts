import { postclawHandlers } from '@/lib/postclaw-handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = postclawHandlers.createPost;
export const GET = postclawHandlers.listPosts;
