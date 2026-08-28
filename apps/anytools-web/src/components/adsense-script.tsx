// Google AdSense loader. AdSense is the PRIMARY money channel for anytools
// (docs/anytools/monetization.md) — visitors here use a tool rather than buy a
// product, so affiliate is secondary.
//
// Plain <script async>, NOT next/script: React 19 hoists async scripts into
// <head> of the SERVER-rendered HTML, which is what Google's site-verification
// crawler reads. next/script's afterInteractive strategy injects the tag from
// the client, so the raw HTML a reviewer fetches would not contain it and
// verification fails while the site looks fine in a browser.
//
// Deliberately NOT behind the cookie-consent gate that wraps UmamiAnalytics:
// the crawler visits once, without consenting, and must still see the tag.
// Serving real ads to EEA/UK visitors additionally requires a Google-certified
// CMP — a separate step, not a prerequisite for verification.
const PUB_ID = process.env.NEXT_PUBLIC_ADSENSE_PUB_ID ?? 'pub-8231549980592586';

export function AdSenseScript() {
  if (!PUB_ID) return null;
  return (
    <script
      async
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${PUB_ID}`}
      crossOrigin="anonymous"
    />
  );
}
