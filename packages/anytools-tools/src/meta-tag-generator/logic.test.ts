import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUT, type MetaInput, generateMetaTags, validate } from './logic';

const base: MetaInput = {
  ...DEFAULT_INPUT,
  title: 'A page',
  description: 'About the page',
  url: 'https://example.com/page',
  imageUrl: 'https://example.com/og.png',
  siteName: 'Example',
};

describe('generateMetaTags', () => {
  it('emits the description once as a name= tag and once as og:', () => {
    const out = generateMetaTags(base);
    expect(out).toContain('<meta name="description" content="About the page">');
    expect(out).toContain('<meta property="og:description" content="About the page">');
  });

  it('escapes quotes and ampersands in attribute values', () => {
    // A title like: Bob's "Widgets" & Co — unescaped, this closes the attribute early and
    // the rest of the tag becomes markup.
    const out = generateMetaTags({ ...base, title: 'Bob & "Widgets" <b>' });
    expect(out).toContain('content="Bob &amp; &quot;Widgets&quot; &lt;b&gt;"');
    expect(out).not.toContain('content="Bob & "Widgets"');
  });

  it('omits tags for fields left blank rather than emitting empty ones', () => {
    const out = generateMetaTags({ ...DEFAULT_INPUT, title: 'Only a title' });
    expect(out).not.toContain('og:image');
    expect(out).not.toContain('canonical');
    expect(out).toContain('<title>Only a title</title>');
  });

  it('always emits robots and a twitter card type', () => {
    const out = generateMetaTags(DEFAULT_INPUT);
    expect(out).toContain('<meta name="robots" content="index, follow">');
    expect(out).toContain('<meta name="twitter:card" content="summary_large_image">');
  });
});

describe('validate', () => {
  it('warns about a relative og:image — crawlers fetch it without page context', () => {
    const w = validate({ ...base, imageUrl: '/og.png' });
    expect(w.some((x) => x.field === 'imageUrl' && /absolute/.test(x.message))).toBe(true);
  });

  it('warns when a large-image card has no image', () => {
    const w = validate({ ...base, imageUrl: '', cardType: 'summary_large_image' });
    expect(w.some((x) => /falls back to a plain summary/.test(x.message))).toBe(true);
  });

  it('warns past the truncation lengths, with the real count', () => {
    const w = validate({ ...base, title: 'x'.repeat(75) });
    expect(w.some((x) => x.field === 'title' && x.message.includes('75 characters'))).toBe(true);
  });

  it('warns about a handle with no @', () => {
    expect(validate({ ...base, twitterHandle: 'example' })).toHaveLength(1);
  });

  it('is silent on a well-formed input', () => {
    expect(validate(base)).toEqual([]);
  });
});
