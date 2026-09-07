import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Can't import `@/lib/self-hosted` here — next.config.ts runs outside the `@/` path
// alias Next.js's own bundler sets up for `src/**`, so this reads the same
// `NEXT_PUBLIC_SELF_HOSTED` build-arg directly (see self-hosted.ts for the single
// source of truth every other file imports from — this file is the one documented
// exception).
const IS_SELF_HOSTED = process.env.NEXT_PUBLIC_SELF_HOSTED === '1';

// Ad/analytics hosts, spliced into the CSP directives below only in the hosted build.
// A self-host install ships with no AdSense (adsense-script.tsx returns null when the
// flag is on) and no ad program or analytics of its own — allowlisting these hosts in
// the CSP anyway is a claim `curl -I` can catch even though nothing in the page ever
// loads them: review-260903-phase-03.md finding #6 caught exactly that, the header
// still named pagead2.googlesyndication.com/doubleclick.net/google-analytics.com/
// stats.besttoys.world (a leftover from a different site's config) while the rest of
// the build correctly said "no ads, no analytics". `Reporting-Endpoints`/`report-uri`
// stay in both builds — `/api/csp-report` itself is not gated in self-host.
const AD_ANALYTICS_SCRIPT_HOSTS = [
  'https://pagead2.googlesyndication.com',
  'https://*.googlesyndication.com',
  'https://*.googleadservices.com',
  'https://*.doubleclick.net',
  'https://*.adtrafficquality.google',
  'https://fundingchoicesmessages.google.com',
  'https://stats.besttoys.world',
  // Cloudflare Web Analytics beacon. Not in the app's own code: the Cloudflare proxy
  // injects it into the HTML, so it appears only on the hosted site and only became
  // visible once real violations were collected (2026-09-06).
  'https://static.cloudflareinsights.com',
];
const AD_ANALYTICS_CONNECT_HOSTS = [
  'https://pagead2.googlesyndication.com',
  'https://*.googlesyndication.com',
  'https://*.doubleclick.net',
  'https://*.adtrafficquality.google',
  'https://*.google-analytics.com',
  'https://stats.besttoys.world',
];
const AD_ANALYTICS_FRAME_HOSTS = [
  'https://googleads.g.doubleclick.net',
  'https://tpc.googlesyndication.com',
  'https://*.safeframe.googlesyndication.com',
  'https://*.adtrafficquality.google',
  // AdSense frames an interstitial from the bare google.com host; measured on every
  // ad-bearing page, not just one (2026-09-06).
  'https://www.google.com',
];
// Deliberately no CDN host for Excalidraw fonts. Measured 2026-09-06: across four fresh
// /design/whiteboard loads the browser made ZERO font requests to that CDN while reporting
// 230 violations every time. The reports come from FontFace construction, not from fetching —
// Excalidraw bakes a CDN fallback into each FontFace's source list, and the browser CSP-checks
// every source when the object is built.
// Re-measured 2026-09-07, because the earlier walk never created a text element and so read as
// "no font is fetched at all": once text exists, Excalifont IS fetched, once, from our own
// /third-party/excalidraw/ copy. `window.EXCALIDRAW_ASSET_PATH` (whiteboard/ui.tsx) works, the
// tool is not degraded, and the fallback is never reached.
// The 230 checks themselves are now gone at the source: whiteboard/same-origin-font-guard.ts
// wraps FontFace and strips cross-origin entries before construction, so the browser has
// nothing cross-origin left to check — and no longer POSTs 230 reports per whiteboard load,
// which was drowning any real violation. This directive stays tight either way; the guard is
// defence in depth, not a licence to widen it. vendor-assets.test.ts also greps this file for
// CDN hostnames precisely to stop one being written here.
// Appends a leading space + the host list when hosted, or nothing at all in
// self-host — string-identical to the old hard-coded directive when hosted.
const adHostSuffix = (hosts: string[]) => (IS_SELF_HOSTED ? '' : ` ${hosts.join(' ')}`);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Minimal Docker image: emits .next/standalone with only the runtime deps.
  output: 'standalone',
  // Monorepo: include workspace files in standalone trace.
  outputFileTracingRoot: process.cwd() + '/../..',
  transpilePackages: ['@anytools/ui', '@anytools/tools', '@anytools/i18n', '@anytools/analytics'],
  experimental: {
    // `@anytools/ui` is a barrel, and the eagerly-loaded shell (tool-toolbar, the tool page,
    // the header) imports from it — so adding Radix Select/Checkbox/RadioGroup/Label to the
    // barrel put all four into the tool route's first load, +23 kB, even on the ~90 tools that
    // use none of them. Measured: tool route 196 kB -> 219 kB after Phase 1, while the
    // shared-by-all chunk stayed at 111 kB. This rewrites barrel imports to deep ones at build
    // time so only what a module actually names gets bundled.
    optimizePackageImports: ['@anytools/ui'],
  },
  serverExternalPackages: [
    'curlconverter',
    'tree-sitter',
    'tree-sitter-bash',
    'better-sqlite3',
    'better-auth',
  ],
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  // www serves the whole site on its own hostname, and the TLS cert covers it, so Google indexed
  // BOTH hosts. Inspection on 2026-08-31: `https://www.anytools.world/` came back "Submitted and
  // indexed" while the apex homepage came back "Duplicate, Google chose different canonical than
  // user" — Google picked the www copy over the one the sitemap and every canonical tag declare.
  // A canonical tag is a hint; a 301 is not. This runs before the locale middleware, so the
  // redirect lands on the apex host with the path intact and the middleware resolves the locale
  // there, exactly as it does for direct apex traffic.
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.anytools.world' }],
        destination: 'https://anytools.world/:path*',
        permanent: true,
      },
    ];
  },
  async headers() {
    const responseHeaders = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // HSTS + preload assumes the browser reached this response over TLS on a domain
      // this operator controls forever. A self-host install is commonly reached over
      // plain HTTP on a LAN/localhost — sending `preload` there is a trap: browsers
      // that have cached the preload directive will refuse to load the site over HTTP
      // ever again, even after the operator points a real domain + cert at it later.
      // Filtered out below (rather than made conditional on scheme, which this
      // function has no way to know at build time).
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
      // ENFORCING since 2026-09-06. The PDF tools parse attacker-supplied files with
      // pdf.js, which has a documented class of arbitrary-JS-execution bugs through the
      // font path (CVE-2024-4367 and successors), and better-auth keeps a 30-day session
      // cookie on this same origin — report-only bought nothing against either.
      //
      // The policy shipped report-only first because AdSense loads a chain of scripts
      // whose hosts are not enumerable in advance, and an over-tight policy would
      // silently kill the site's only revenue. That collection step is now done, but not
      // from server logs: at ~16 visitors / 90 days, waiting for organic reports would
      // have taken weeks, so a headless Chrome walked 15 pages and ran the merge-pdf,
      // regex-worker and OCR paths on production while recording every
      // `securitypolicyviolation` event. Exactly three distinct violations existed:
      //
      //   230x  font-src         <a public CDN>              (Excalidraw FontFace fallback)
      //     1x  frame-src        https://www.google.com      (AdSense interstitial)
      //     1x  script-src-elem  https://static.cloudflareinsights.com
      //
      // The last two are now allowed. The first is deliberately NOT — see the note above
      // EXCALIDRAW's font handling: those reports came from FontFace construction, not from
      // a fetch, and enforcing simply drops a fallback the tool never uses. As of 2026-09-07
      // the font guard removes those sources before construction, so that count should now be
      // zero — if it climbs back, upstream changed and the guard stopped matching. Nothing
      // else in the app tripped the policy, and the browser reported no non-CSP console errors
      // during the same walk. `report-uri` stays so a regression still surfaces.
      { key: 'Reporting-Endpoints', value: 'csp="/api/csp-report"' },
      {
        key: 'Content-Security-Policy',
        value: [
          "default-src 'self'",
          // 'unsafe-inline'/'unsafe-eval' are required by Next's inline bootstrap and by
          // the ad stack. They are what a later enforcing policy should try to remove,
          // via nonces, once the report data shows what actually loads.
          `script-src 'self' 'unsafe-inline' 'unsafe-eval'${adHostSuffix(AD_ANALYTICS_SCRIPT_HOSTS)}`,
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob: https:",
          // blob: is what the PDF and image tools use for their output; worker-src is
          // what pdf.js needs for pdf.worker.
          "worker-src 'self' blob:",
          // No blob: here, and no media-src at all (so media falls back to default-src 'self').
          // Measured 2026-09-07 while building audio-trim: that combination blocks BOTH
          // fetch(blobUrl) and <audio src="blob:...">, which is how most audio libraries load a
          // local file — wavesurfer.js's loadBlob() does exactly that and fails silently except
          // for a securitypolicyviolation event. The fix there was to stop round-tripping through
          // a blob URL (decode the bytes with AudioContext.decodeAudioData directly), which is
          // better code anyway, so nothing here was loosened. A future audio/video tool will hit
          // the same wall: decode from bytes, or argue for media-src — do not quietly add blob:
          // to connect-src. Note <img src="blob:"> and workers are already allowed above, and a
          // MediaStream attached via srcObject (qr-barcode-scanner's camera) is not URL-governed
          // at all, so neither is affected.
          `connect-src 'self'${adHostSuffix(AD_ANALYTICS_CONNECT_HOSTS)}`,
          `frame-src 'self'${adHostSuffix(AD_ANALYTICS_FRAME_HOSTS)}`,
          "font-src 'self' data:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
          // Without a destination the header only prints into each visitor's own console
          // and the operator learns nothing — the "collect, then enforce" plan above
          // cannot reach its second step. report-uri is the legacy form and still the
          // one browsers reliably honour for report-only.
          'report-uri /api/csp-report',
          'report-to csp',
        ].join('; '),
      },
    ];
    return [
      {
        source: '/(.*)',
        headers: responseHeaders.filter(
          (h) => !(IS_SELF_HOSTED && h.key === 'Strict-Transport-Security'),
        ),
      },
    ];
  },
};

export default withNextIntl(nextConfig);
