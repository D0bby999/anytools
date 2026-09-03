// /ads.txt — see src/lib/ads-txt.ts for what the file is and why the body lives there.
//
// In production this route is normally shadowed by the Cloudflare Worker on the
// anytools.world/ads.txt route (workers/ads-txt), which answers from the edge so an
// AdSense crawl cannot land on a container that is mid-redeploy. This route stays the
// origin-of-record: it is what runs locally, in preview, and if the Worker is removed.

import { adsTxtBody } from '@/lib/ads-txt';

export const dynamic = 'force-static';

export function GET(): Response {
  return new Response(adsTxtBody(), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
