// Guards the render-time affiliate rewrite for HTML-format posts.
//
// The bug this exists to prevent is invisible from the page: a link that looks
// perfect, clicks through to the right product, and pays nobody because the tag
// is missing. Nothing about the rendered post reveals it — only these assertions do.

import { describe, expect, it } from 'vitest';

import { applyAffiliateLinks, containsAffiliateLink } from '../apply-affiliate-links';

const AMAZON_HOSTS = ['amazon.com', 'amazon.co.uk', 'amazon.de'];

function isAmazon(href: string): boolean {
  try {
    const h = new URL(href).hostname.toLowerCase();
    return AMAZON_HOSTS.some((s) => h === s || h.endsWith(`.${s}`));
  } catch {
    return false;
  }
}

function buildUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.delete('tag');
  url.searchParams.set('tag', 'pettech01a-20');
  return url.toString();
}

const rewrite = (html: string) => applyAffiliateLinks(html, isAmazon, buildUrl);

describe('applyAffiliateLinks', () => {
  it('adds our tag to a bare Amazon link', () => {
    const out = rewrite('<p><a href="https://www.amazon.com/dp/B0CQ5D823D">Polar</a></p>');
    expect(out).toContain('tag=pettech01a-20');
  });

  it('replaces a foreign tag rather than appending ours beside it', () => {
    // A tag pasted in from copied content must not survive: leaving it credits
    // a stranger for our sale, and two tags is not a valid Amazon URL anyway.
    const out = rewrite('<a href="https://www.amazon.com/dp/B0CQ5D823D?tag=someoneelse-20">x</a>');
    expect(out).toContain('tag=pettech01a-20');
    expect(out).not.toContain('someoneelse-20');
  });

  it('carries the sponsored + nofollow rel tokens', () => {
    const out = rewrite('<a href="https://www.amazon.com/dp/B0CQ5D823D">x</a>');
    const rel = /rel="([^"]*)"/.exec(out)?.[1]?.split(' ') ?? [];
    expect(rel).toEqual(expect.arrayContaining(['sponsored', 'nofollow', 'noopener']));
  });

  it('merges with the rel the ingest sanitizer already applied', () => {
    // sanitize-post-html stamps rel="nofollow ugc noopener" on every anchor.
    // Dropping `ugc` would silently undo that policy.
    const out = rewrite(
      '<a href="https://www.amazon.com/dp/B0CQ5D823D" rel="nofollow ugc noopener">x</a>',
    );
    const rel = /rel="([^"]*)"/.exec(out)?.[1]?.split(' ') ?? [];
    expect(rel).toEqual(expect.arrayContaining(['ugc', 'sponsored', 'nofollow']));
    expect(rel.filter((t) => t === 'nofollow')).toHaveLength(1);
  });

  it('leaves non-Amazon links completely untouched', () => {
    const html = '<a href="https://petlibro.com/products/polar" rel="nofollow">source</a>';
    expect(rewrite(html)).toBe(html);
  });

  it('rewrites every Amazon link in a post, not just the first', () => {
    const out = rewrite(
      '<a href="https://www.amazon.com/dp/AAAAAAAAAA">a</a>' +
        '<a href="https://example.com">b</a>' +
        '<a href="https://www.amazon.co.uk/dp/BBBBBBBBBB">c</a>',
    );
    expect(out.match(/tag=pettech01a-20/g)).toHaveLength(2);
  });

  it('decodes &amp; in an href before parsing it as a URL', () => {
    // sanitize-html escapes `&` in attributes. Parsing the escaped form would
    // produce a query parameter literally named "amp;th" and a broken link.
    const out = rewrite('<a href="https://www.amazon.com/dp/B0X?th=1&amp;psc=1">x</a>');
    const href = /href="([^"]*)"/.exec(out)?.[1] ?? '';
    // Read the parameters the browser will actually see, not the escaped source.
    const params = new URL(href.replace(/&amp;/g, '&')).searchParams;
    expect([...params.keys()]).toEqual(['th', 'psc', 'tag']);
    expect(params.get('tag')).toBe('pettech01a-20');
  });

  it('re-escapes & in the rewritten href so the attribute stays valid HTML', () => {
    const out = rewrite('<a href="https://www.amazon.com/dp/B0X?th=1">x</a>');
    const href = /href="([^"]*)"/.exec(out)?.[1] ?? '';
    expect(href).toContain('&amp;');
    expect(href).not.toMatch(/&(?!amp;)/);
  });

  it('preserves other attributes on the anchor', () => {
    const out = rewrite('<a class="btn" href="https://www.amazon.com/dp/B0X" title="Buy">x</a>');
    expect(out).toContain('class="btn"');
    expect(out).toContain('title="Buy"');
  });

  it('handles single-quoted attributes', () => {
    const out = rewrite("<a href='https://www.amazon.com/dp/B0X'>x</a>");
    expect(out).toContain('tag=pettech01a-20');
  });

  it('ignores an anchor with no href', () => {
    const html = '<a name="section">x</a>';
    expect(rewrite(html)).toBe(html);
  });

  it('does not mangle a URL containing regex replacement patterns', () => {
    // `$&` and `$1` in a string-form replacement would splice in the match.
    const out = rewrite('<a href="https://www.amazon.com/dp/B0X?q=$1%26$@">x</a>');
    expect(out).toContain('tag=pettech01a-20');
    expect(out).not.toContain('href="href=');
  });

  it('leaves a body with no links alone', () => {
    const html = '<p>No links here.</p>';
    expect(rewrite(html)).toBe(html);
  });
});

describe('applyAffiliateLinks — per-post attribution', () => {
  const withSub = (html: string) =>
    applyAffiliateLinks(html, isAmazon, buildUrl, 'pettech-my-slug');

  it('stamps ascsubtag so Amazon reports earnings per post', () => {
    const out = withSub('<a href="https://www.amazon.com/dp/B0X">x</a>');
    expect(out).toContain('ascsubtag=pettech-my-slug');
  });

  it('does not overwrite a subtag the content already carries', () => {
    const out = withSub('<a href="https://www.amazon.com/dp/B0X?ascsubtag=pettech-older">x</a>');
    expect(out).toContain('ascsubtag=pettech-older');
    expect(out).not.toContain('pettech-my-slug');
  });

  it('leaves non-product Amazon links unstamped', () => {
    // A storefront or search URL is not a post-attributable product click.
    const out = withSub('<a href="https://www.amazon.com/stores/petlibro">brand</a>');
    expect(out).not.toContain('ascsubtag');
  });

  it('omits ascsubtag entirely when no subtag is supplied', () => {
    const out = rewrite('<a href="https://www.amazon.com/dp/B0X">x</a>');
    expect(out).not.toContain('ascsubtag');
  });
});

describe('containsAffiliateLink', () => {
  const has = (html: string) => containsAffiliateLink(html, isAmazon);

  it('detects an Amazon link so the FTC disclosure renders', () => {
    expect(has('<p>x</p><a href="https://www.amazon.com/dp/B0X">buy</a>')).toBe(true);
  });

  it('is false for a post whose only links are sources', () => {
    // A false positive here publishes an "I earn from qualifying purchases"
    // claim on a post that earns nothing — a disclosure that is simply untrue.
    expect(has('<a href="https://petlibro.com">spec sheet</a>')).toBe(false);
  });

  it('is false for a post with no links at all', () => {
    expect(has('<p>Plain prose.</p>')).toBe(false);
  });

  it('sees an Amazon link that appears after several other links', () => {
    expect(
      has(
        '<a href="https://a.com">1</a><a href="https://b.com">2</a>' +
          '<a href="https://www.amazon.de/dp/B0X">3</a>',
      ),
    ).toBe(true);
  });

  it('decodes entities before matching the host', () => {
    expect(has('<a href="https://www.amazon.com/dp/B0X?a=1&amp;b=2">buy</a>')).toBe(true);
  });
});

describe('applyAffiliateLinks — click instrumentation', () => {
  // Amazon reports what it attributes to our tag, on its own schedule and never
  // per page. Without a click event on our side there is no way to tell a post
  // that sends buyers to Amazon from one nobody reads.
  it('marks an Amazon link as a trackable affiliate click', () => {
    expect(rewrite('<a href="https://www.amazon.com/dp/B0BQZ9K3LM">buy</a>')).toContain(
      'data-umami-event="affiliate-click"',
    );
  });

  it('records which product was clicked', () => {
    expect(rewrite('<a href="https://www.amazon.com/dp/B0BQZ9K3LM">buy</a>')).toContain(
      'data-umami-event-asin="B0BQZ9K3LM"',
    );
  });

  it('leaves non-Amazon links uninstrumented', () => {
    const html = '<a href="https://petlibro.com/specs">spec sheet</a>';
    expect(rewrite(html)).toBe(html);
  });

  it('records no product rather than a truncated one when the token is not an ASIN', () => {
    const out = rewrite('<a href="https://www.amazon.com/dp/B0BQZ9K3LMXX">buy</a>');
    expect(out).toContain('data-umami-event="affiliate-click"');
    expect(out).not.toContain('data-umami-event-asin');
  });

  it('omits the asin attribute for a storefront link that names no product', () => {
    const out = rewrite('<a href="https://www.amazon.com/stores/petlibro">shop</a>');
    expect(out).toContain('data-umami-event="affiliate-click"');
    expect(out).not.toContain('data-umami-event-asin');
  });

  it('does not double-instrument a link that already carries an event', () => {
    const out = rewrite(
      '<a href="https://www.amazon.com/dp/B0BQZ9K3LM" data-umami-event="custom">buy</a>',
    );
    expect(out.match(/data-umami-event=/g)).toHaveLength(1);
    expect(out).toContain('data-umami-event="custom"');
  });

  it('still applies the tag and rel tokens alongside the event', () => {
    const out = rewrite('<a href="https://www.amazon.com/dp/B0BQZ9K3LM">buy</a>');
    expect(out).toContain('tag=pettech01a-20');
    expect(out).toContain('sponsored');
  });
});
