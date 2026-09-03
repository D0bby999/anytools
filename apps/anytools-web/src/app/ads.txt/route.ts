// /ads.txt — see src/lib/ads-txt.ts for what the file is and why the body lives there.
//
// In production this route is normally shadowed by the Cloudflare Worker on the
// anytools.world/ads.txt route (workers/ads-txt), which answers from the edge so an
// AdSense crawl cannot land on a container that is mid-redeploy. This route stays the
// origin-of-record: it is what runs locally, in preview, and if the Worker is removed.

import { adsTxtBody } from '@/lib/ads-txt';
import { IS_SELF_HOSTED } from '@/lib/self-hosted';

export const dynamic = 'force-static';

export function GET(): Response {
  // Self-host builds carry no ad program of their own (see adsense-script.tsx) — an
  // ads.txt naming the hosted site's AdSense publisher would misrepresent a stranger's
  // install as an authorized seller for that account.
  if (IS_SELF_HOSTED) return new Response(null, { status: 404 });
  return new Response(adsTxtBody(), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
