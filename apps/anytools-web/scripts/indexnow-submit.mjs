#!/usr/bin/env node
/**
 * Tell IndexNow (Bing, Yandex, Seznam, Naver) which URLs changed, after a deploy.
 *
 * Google ignores IndexNow, so this does nothing for the site's main search channel —
 * it exists because Bing otherwise discovers new tool pages on its own schedule, and
 * the cost here is one HTTP request per deploy.
 *
 * The URL list comes from the live sitemap rather than a hand-kept list, so it can
 * never drift from what the site actually submits to crawlers. Ownership is proven by
 * `public/<key>.txt`, which is served as a static file from the same origin.
 *
 * Failure is never fatal: a deploy must not be marked broken because Bing's endpoint
 * had a bad minute. Exits 0 on every path, printing what happened.
 *
 * Usage: node scripts/indexnow-submit.mjs [--base=https://anytools.world]
 */

const KEY = '7a9b0aed69c1f867979dea82687e28f2';
const baseArg = process.argv.find((a) => a.startsWith('--base='));
const BASE = (baseArg ? baseArg.slice('--base='.length) : 'https://anytools.world').replace(
  /\/$/,
  '',
);
const HOST = new URL(BASE).host;
// IndexNow accepts at most 10,000 URLs per request.
const MAX_URLS = 10_000;

async function main() {
  let xml;
  try {
    const res = await fetch(`${BASE}/sitemap.xml`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      console.log(`indexnow: sitemap returned ${res.status} — skipping`);
      return;
    }
    xml = await res.text();
  } catch (error) {
    console.log(`indexnow: cannot fetch sitemap (${error.message}) — skipping`);
    return;
  }

  const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].trim())
    .filter((u) => u.startsWith(`${BASE}/`))
    .slice(0, MAX_URLS);

  if (urlList.length === 0) {
    console.log('indexnow: sitemap had no URLs for this host — skipping');
    return;
  }

  // Prove the key is actually served before announcing it; IndexNow rejects the whole
  // submission when the key file 404s, and that failure is silent from the caller's side.
  try {
    const keyRes = await fetch(`${BASE}/${KEY}.txt`, { signal: AbortSignal.timeout(15_000) });
    const body = keyRes.ok ? (await keyRes.text()).trim() : '';
    if (body !== KEY) {
      console.log(`indexnow: key file not served correctly at /${KEY}.txt — skipping`);
      return;
    }
  } catch (error) {
    console.log(`indexnow: cannot verify key file (${error.message}) — skipping`);
    return;
  }

  try {
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: HOST,
        key: KEY,
        keyLocation: `${BASE}/${KEY}.txt`,
        urlList,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    // 200 and 202 both mean accepted; 422 means the key or URLs were rejected.
    console.log(`indexnow: submitted ${urlList.length} URLs -> HTTP ${res.status}`);
    if (!res.ok) console.log(`indexnow: response body: ${(await res.text()).slice(0, 300)}`);
  } catch (error) {
    console.log(`indexnow: submission failed (${error.message}) — ignoring`);
  }
}

await main();
