/**
 * Single source of truth for the AdSense publisher identity.
 *
 * Hard-coded rather than read from env, deliberately. The ID is public — it ships in
 * every page's loader URL and in /ads.txt — so there is nothing to protect, while an
 * unset or misspelled env var fails SILENTLY: /ads.txt emits a placeholder and ad slots
 * render nothing, and neither shows up as an error anyone would notice. That is exactly
 * what happened here: `ad-slot.tsx` read NEXT_PUBLIC_ADSENSE_CLIENT while
 * `adsense-script.tsx` read NEXT_PUBLIC_ADSENSE_PUB_ID, only the latter was ever set,
 * and production served the loader script with zero ad units for months.
 *
 * Self-host builds must not carry this identity at all — see IS_SELF_HOSTED in
 * self-hosted.ts and its two call sites (adsense-script.tsx, app/ads.txt/route.ts).
 *
 * The Cloudflare Worker at workers/ads-txt keeps its own copy of the publisher line
 * because it deploys separately and cannot import this module; ads-txt.test.ts is what
 * stops the two drifting apart.
 */
export const ADSENSE_PUB_ID = 'pub-8231549980592586';

/** The same publisher in the `client=` form the loader script and `<ins>` tags require. */
export const ADSENSE_CLIENT_ID = `ca-${ADSENSE_PUB_ID}`;

/**
 * Numeric ad-unit slot IDs, keyed by the placement name pages pass to <AdSlot>.
 *
 * EMPTY ON PURPOSE until the account is approved. Ad units can only be created in the
 * AdSense dashboard, which is unreachable before approval, and `data-ad-slot` will not
 * accept anything but the number it hands out — the placement names ('tool-page-end' and
 * friends) were never valid values for it. An <ins> carrying a bogus slot is worse than
 * no <ins> at all while a reviewer is looking at the site, so AdSlot renders nothing
 * until a real number lands here.
 *
 * After approval: create one unit per key below, paste its numeric ID, and the existing
 * <AdSlot> call sites start serving with no other change.
 */
export const AD_SLOT_IDS: Readonly<Record<string, string>> = {
  // 'tool-page-end': '1234567890',
  // 'tool-page-bottom': '1234567890',
  // 'blog-end': '1234567890',
  // 'guide-end': '1234567890',
};
