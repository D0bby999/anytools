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
  it('leaves non-ASCII text alone by default and references it on request', () => {
    expect(encodeHtml('Xin chào <b>')).toBe('Xin chào &lt;b&gt;');
    expect(encodeHtml('Xin chào <b>', { encodeNonAscii: true })).toBe('Xin ch&agrave;o &lt;b&gt;');
  });
  it('escapes quotes so the output is safe inside attributes', () => {
    expect(encodeHtml(`"a" 'b'`)).toBe('&quot;a&quot; &#x27;b&#x27;');
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
