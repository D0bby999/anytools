// Canonical body of /ads.txt — the IAB authorized-sellers file Google AdSense reads
// during review and again on every ad request. An unlisted publisher means unfilled ads.
//
// This lives in its own module because the file is served from TWO places: the Next
// route at src/app/ads.txt, and a Cloudflare Worker (workers/ads-txt) that keeps the
// file answering from the edge while the container is being swapped on deploy. The
// Worker ships through `wrangler deploy` rather than the app image, so it cannot import
// this module; ads-txt.test.ts is what stops the two copies drifting apart.

/**
 * Publisher ID baked in as a fallback (same pattern as the Amazon tag in
 * affiliate-url.ts) so the file stays correct without depending on a Coolify env var
 * being set — a silently empty env would emit the placeholder and still look fine.
 */
export const ADSENSE_PUB_ID_FALLBACK = 'pub-8231549980592586';

/** The single authorized-seller line, exactly as it must appear on disk. */
export function adsTxtLine(pub: string): string {
  return `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`;
}

/** Full file body: the seller line, or an explanatory placeholder when no pub ID is set. */
export function adsTxtBody(
  pub: string | undefined = process.env.ADSENSE_PUB_ID ?? ADSENSE_PUB_ID_FALLBACK,
): string {
  return pub
    ? adsTxtLine(pub)
    : [
        '# ads.txt placeholder — no ad network authorized yet.',
        '# After Google AdSense approval, set ADSENSE_PUB_ID env (pub-XXXXXXXXXXXXXXXX);',
        '# this route will then emit:',
        '#   google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0',
        '',
      ].join('\n');
}
