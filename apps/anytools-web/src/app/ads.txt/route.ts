// /ads.txt — IAB authorized-sellers file required by Google AdSense / programmatic ads.
// Emits the AdSense authorization line ONLY once the publisher ID is configured
// (set ADSENSE_PUB_ID in Coolify env after AdSense approval, e.g. pub-1234567890123456).
// Until then it serves a commented placeholder so the route exists and returns 200.

export const dynamic = 'force-static';

export function GET(): Response {
  const pub = process.env.ADSENSE_PUB_ID;
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
