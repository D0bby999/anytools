// Serves /ads.txt for anytools.world from the Cloudflare edge.
//
// Why a Worker for a 59-byte file: Cloudflare answers /ads.txt with
// `cf-cache-status: DYNAMIC` on every request — a .txt is not in the Free plan's
// default cacheable set, and the Cache Rule that would change that needs a zone-scoped
// API token this project does not hold. So every ads.txt check Google makes travels all
// the way to the Coolify container, and while that container is being swapped on deploy
// the file is simply not there. An AdSense crawl landing in that window records
// "not found", and the next check is a day or more away.
//
// Sitting on the route removes the origin from the path completely: the file answers
// even mid-redeploy, and even if the app is down entirely.
//
// The line below is duplicated from apps/anytools-web/src/lib/ads-txt.ts on purpose —
// this Worker ships via `wrangler deploy`, not the app image, so it cannot import from
// the Next build. `ads-txt.test.ts` in the web app fails if the two ever disagree.
const ADS_TXT = 'google.com, pub-8231549980592586, DIRECT, f08c47fec0942fa0\n';

export default {
  fetch() {
    return new Response(ADS_TXT, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        // The publisher only changes when the AdSense account does, so a long TTL is
        // safe and keeps Google's repeat checks off the Worker entirely.
        'cache-control': 'public, max-age=3600, s-maxage=86400',
        'x-content-type-options': 'nosniff',
      },
    });
  },
};
