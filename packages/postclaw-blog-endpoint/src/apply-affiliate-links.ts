// Render-time affiliate rewriting for HTML-format posts.
//
// MDX posts get this for free: every `<a>` in them is rendered by the app's own
// mdx-components, which forces our Amazon tag on and adds the sponsored/nofollow
// rel tokens. HTML posts — the ones ingested from PostClaw through the
// custom_blog endpoints — are injected with dangerouslySetInnerHTML, so nothing
// ever touched their links. An Amazon link on one of those posts was published
// untagged: the reader clicked, the sale went through, and it credited nobody.
//
// Runs at RENDER time rather than at ingest deliberately. The tag lives in an
// env var; baking it into stored HTML would freeze whatever tag was current on
// the day of ingest, and a later tag change would silently stop applying to
// every post already in the database. Rewriting on the way out means one env
// change fixes every post at once — the same property the MDX path has.
//
// `buildUrl` is injected because the tag is per-site (each app owns its own
// Associates Store ID in src/lib/affiliate-url.ts); this module owns the HTML
// surgery, not the tag policy.

/** rel tokens every outbound affiliate link must carry. */
const REQUIRED_REL = ['sponsored', 'nofollow', 'noopener'];

// `[^>]*` is safe here because the input is sanitize-html output, which escapes
// `>` inside attribute values to `&gt;` — an attribute can never close the tag.
const RE_ANCHOR = /<a\b([^>]*)>/gi;
const RE_HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const RE_REL = /\brel\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

/**
 * Decode the HTML entities sanitize-html emits inside attribute values.
 *
 * `&amp;` MUST be decoded last. Decoding it first turns the literal text
 * `&amp;lt;` into `&lt;` and then into `<`, inventing a character the author
 * never wrote. Doing every other entity first leaves `&amp;lt;` correctly at
 * `&lt;`.
 */
function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Re-escape a value for use inside a double-quoted HTML attribute. */
function encodeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Union of the rel tokens already present and the ones we require, order-stable. */
function mergeRel(existing: string | undefined): string {
  const present = (existing ?? '').split(/\s+/).filter(Boolean);
  return [...new Set([...present, ...REQUIRED_REL])].join(' ');
}

/**
 * Force the affiliate tag and rel tokens onto every Amazon anchor in an HTML body.
 *
 * Non-Amazon anchors are returned byte-for-byte unchanged — `isAmazon` decides,
 * and a link this function does not recognise is a link it does not touch.
 *
 * @param html     Post body. Must already be sanitized; this only edits href/rel.
 * @param isAmazon Predicate identifying Amazon storefront URLs.
 * @param buildUrl Returns the tagged URL for an Amazon href.
 */
/**
 * True when the body carries at least one Amazon link.
 *
 * Drives the FTC disclosure on HTML posts. Those arrive with no `disclosureType`
 * in their frontmatter — the field is an MDX authoring convention — so without
 * this the required "As an Amazon Associate…" notice simply never renders on a
 * post full of affiliate links. Deriving it from the links actually present
 * keeps the two in lockstep: no link, no claim; a link, always the disclosure.
 */
export function containsAffiliateLink(html: string, isAmazon: (href: string) => boolean): boolean {
  for (const match of html.matchAll(RE_ANCHOR)) {
    const href = RE_HREF.exec(match[1] ?? '');
    if (href && isAmazon(decodeAttr(href[1] ?? href[2] ?? ''))) return true;
  }
  return false;
}

/** Amazon product-page shapes worth attributing per post. */
const RE_PRODUCT_PATH = /\/(dp|gp\/product|gp\/aw\/d)\//;

// Click instrumentation. Amazon reports what it attributes to our tag, but only
// after it decides to, and never per page in near-real-time; on 2026-08-28 the
// dashboard was still two days behind. Meanwhile nothing on our side recorded
// whether any of ~300 visitors per 90 days ever reached a product page, so
// "does this traffic convert?" had no answer at all and no post could be told
// apart from a dead one.
//
// Umami's tracker fires on these attributes with no extra JS and no cookie, and
// it already records the page the click happened on — so the anchor only needs
// to name the event and which product it points at.
const RE_UMAMI_EVENT = /\bdata-umami-event\s*=/i;
// An ASIN is exactly ten characters. The trailing boundary matters: without it a
// longer token silently reports its first ten, which reads as a real ASIN in the
// dashboard and points at nothing. Better to record no product than a wrong one.
const RE_ASIN = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?![A-Z0-9])/i;

/**
 * Add `ascsubtag=<subtag>` unless the link already carries one.
 *
 * This is what makes Amazon report earnings PER POST, so you can see which
 * articles actually sell and which are dead weight. MDX posts get it from
 * scripts/affiliate-subtag.mjs, which walks content files on disk — a script
 * that structurally cannot see HTML posts, because those exist only in the
 * database. Without this, every ingested post reports as one anonymous lump.
 */
function withSubtag(url: string, subtag: string): string {
  if (!RE_PRODUCT_PATH.test(url) || /[?&]ascsubtag=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}ascsubtag=${subtag}`;
}

/**
 * Force the affiliate tag and rel tokens onto every Amazon anchor in an HTML body.
 *
 * Non-Amazon anchors come back byte-for-byte unchanged — `isAmazon` decides, and
 * a link this function does not recognise is a link it does not touch.
 *
 * @param html     Post body. Already sanitized; this only edits href and rel.
 * @param isAmazon Predicate identifying Amazon storefront URLs.
 * @param buildUrl Returns the correctly tagged URL for an Amazon href.
 * @param subtag   Optional per-post attribution token, e.g. `pettech-<slug>`.
 */
export function applyAffiliateLinks(
  html: string,
  isAmazon: (href: string) => boolean,
  buildUrl: (href: string) => string,
  subtag?: string,
): string {
  return html.replace(RE_ANCHOR, (tag, attrs: string) => {
    const href = RE_HREF.exec(attrs);
    if (!href) return tag;

    const decoded = decodeAttr(href[1] ?? href[2] ?? '');
    if (!isAmazon(decoded)) return tag;

    // Function replacers throughout: a URL containing `$&` or `$1` would be
    // mangled by string-form replacement patterns.
    const built = buildUrl(decoded);
    const tagged = encodeAttr(subtag ? withSubtag(built, subtag) : built);
    let next = attrs.replace(RE_HREF, () => `href="${tagged}"`);

    const rel = RE_REL.exec(next);
    const merged = encodeAttr(mergeRel(rel ? decodeAttr(rel[1] ?? rel[2] ?? '') : undefined));
    next = rel
      ? next.replace(RE_REL, () => `rel="${merged}"`)
      : `${next.replace(/\s*$/, '')} rel="${merged}"`;

    if (!RE_UMAMI_EVENT.test(next)) {
      next = `${next.replace(/\s*$/, '')} data-umami-event="affiliate-click"`;
      const asin = RE_ASIN.exec(built);
      if (asin?.[1]) next += ` data-umami-event-asin="${encodeAttr(asin[1])}"`;
    }

    return `<a${next}>`;
  });
}
