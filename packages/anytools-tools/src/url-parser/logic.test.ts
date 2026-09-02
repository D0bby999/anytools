import { describe, expect, it } from 'vitest';
import { UrlParseError, parseUrl } from './logic';

describe('parseUrl', () => {
  it('splits a full URL into its parts', () => {
    const u = parseUrl('https://user:pw@example.com:8443/a/b?x=1&y=2#frag');
    expect(u.protocol).toBe('https:');
    expect(u.username).toBe('user');
    expect(u.hostname).toBe('example.com');
    expect(u.port).toBe('8443');
    expect(u.pathname).toBe('/a/b');
    expect(u.segments).toEqual(['a', 'b']);
    expect(u.hash).toBe('#frag');
    expect(u.origin).toBe('https://example.com:8443');
  });

  it('fills in the default port when none is stated', () => {
    expect(parseUrl('https://example.com/').effectivePort).toBe('443');
    expect(parseUrl('http://example.com/').effectivePort).toBe('80');
    // ...without pretending it was in the input.
    expect(parseUrl('https://example.com/').port).toBe('');
  });

  it('keeps repeated query keys instead of collapsing them', () => {
    // ?tag=a&tag=b is legal and meaningful; a Record<string,string> silently loses one.
    const p = parseUrl('https://e.com/?tag=a&tag=b').params;
    expect(p).toEqual([
      { key: 'tag', value: 'a' },
      { key: 'tag', value: 'b' },
    ]);
  });

  it('decodes percent-encoded path segments', () => {
    expect(parseUrl('https://e.com/hello%20world/caf%C3%A9').segments).toEqual([
      'hello world',
      'café',
    ]);
  });

  it('survives a malformed escape in the path rather than throwing', () => {
    expect(parseUrl('https://e.com/100%').segments).toEqual(['100%']);
  });

  it('assumes https for a bare host', () => {
    expect(parseUrl('example.com/path').protocol).toBe('https:');
    expect(parseUrl('example.com/path').hostname).toBe('example.com');
  });

  it('does not paper over a bad scheme', () => {
    // "htp://" has a scheme, so guessing would hide the typo rather than surface it.
    expect(() => parseUrl('htp:// bad url')).toThrow(UrlParseError);
  });

  it('handles a query with no value and an empty query', () => {
    expect(parseUrl('https://e.com/?flag').params).toEqual([{ key: 'flag', value: '' }]);
    expect(parseUrl('https://e.com/').params).toEqual([]);
  });

  it('rejects empty input', () => {
    expect(() => parseUrl('  ')).toThrow(/Enter a URL/);
  });

  it('parses non-http schemes', () => {
    expect(parseUrl('mailto:someone@example.com').protocol).toBe('mailto:');
    expect(parseUrl('ftp://files.example.com/pub').effectivePort).toBe('21');
  });
});
