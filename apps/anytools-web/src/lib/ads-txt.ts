// Canonical body of /ads.txt — the IAB authorized-sellers file Google AdSense reads
// during review and again on every ad request. An unlisted publisher means unfilled ads.
//
// This lives in its own module because the file is served from TWO places: the Next
// route at src/app/ads.txt, and a Cloudflare Worker (workers/ads-txt) that keeps the
// file answering from the edge while the container is being swapped on deploy. The
// Worker ships through `wrangler deploy` rather than the app image, so it cannot import
// this module; ads-txt.test.ts is what stops the two copies drifting apart.

import { ADSENSE_PUB_ID } from './adsense';

/** The single authorized-seller line, exactly as it must appear on disk. */
export function adsTxtLine(pub: string): string {
  return `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`;
}

/** Full file body. The publisher is a constant (see adsense.ts), so there is no
 *  "unconfigured" state to fall back to and no env var that can silently empty it. */
export function adsTxtBody(): string {
  return adsTxtLine(ADSENSE_PUB_ID);
}
