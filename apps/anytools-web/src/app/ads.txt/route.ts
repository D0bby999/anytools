// /ads.txt — IAB authorized-sellers file required by Google AdSense / programmatic ads.
// Declares which publisher is allowed to sell this site's inventory; Google reads it
// during review and again when serving, and an unlisted publisher means unfilled ads.
//
// The publisher ID is baked in as a fallback (same pattern as the Amazon tag in
// affiliate-url.ts) so the file is correct without depending on a Coolify env var
// being set — a silent empty env would serve the placeholder and look fine.

export const dynamic = 'force-static';

export function GET(): Response {
  const pub = process.env.ADSENSE_PUB_ID ?? 'pub-8231549980592586';
  const body = pub
    ? `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`
    : [
        '# ads.txt placeholder — no ad network authorized yet.',
        '# After Google AdSense approval, set ADSENSE_PUB_ID env (pub-XXXXXXXXXXXXXXXX);',
        '# this route will then emit:',
        '#   google.com, pub-XXXXXXXXXXXXXXXX, DIRECT, f08c47fec0942fa0',
        '',
      ].join('\n');

  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
