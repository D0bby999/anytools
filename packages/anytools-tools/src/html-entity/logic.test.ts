import { describe, expect, it } from 'vitest';
import { decodeHtml, encodeHtml } from './logic';

describe('encodeHtml', () => {
  it('encodes script tag (named refs)', () => {
    const out = encodeHtml('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('&lt;/script&gt;');
  });
  it('encodes ampersand', () => {
    expect(encodeHtml('Tom & Jerry')).toContain('Tom &amp; Jerry');
  });
  it('round-trip with unicode', () => {
    const original = 'Café 世界 🌏';
    expect(decodeHtml(encodeHtml(original, { encodeEverything: true }))).toBe(original);
  });
});

describe('decodeHtml', () => {
  it('decodes named entities', () => {
    expect(decodeHtml('&amp; &lt; &gt; &copy;')).toBe('& < > ©');
  });
  it('decodes numeric entities', () => {
    expect(decodeHtml('&#233;')).toBe('é');
  });
  it('decodes hex entities', () => {
    expect(decodeHtml('&#xE9;')).toBe('é');
  });
});
