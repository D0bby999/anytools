import { describe, expect, it } from 'vitest';
import {
  buildQueryString,
  decodeUrlComponent,
  encodeUrl,
  encodeUrlComponent,
  parseQueryString,
} from './logic';

describe('encodeUrlComponent', () => {
  it('encodes space and special chars', () => {
    expect(encodeUrlComponent('hello world')).toBe('hello%20world');
    expect(encodeUrlComponent('a&b=c')).toBe('a%26b%3Dc');
  });
  it('encodes unicode', () => {
    expect(encodeUrlComponent('café')).toBe('caf%C3%A9');
    expect(encodeUrlComponent('世界')).toBe('%E4%B8%96%E7%95%8C');
  });
});

describe('encodeUrl', () => {
  it('preserves URL structural chars', () => {
    expect(encodeUrl('https://example.com/path?a=1')).toBe('https://example.com/path?a=1');
    expect(encodeUrl('https://example.com/with space')).toBe('https://example.com/with%20space');
  });
});

describe('decodeUrlComponent', () => {
  it('round-trips', () => {
    const original = 'Hello, 世界 🌏';
    expect(decodeUrlComponent(encodeUrlComponent(original))).toBe(original);
  });
  it('throws on malformed escape', () => {
    expect(() => decodeUrlComponent('%')).toThrow(/Invalid URL-encoded/);
    expect(() => decodeUrlComponent('%ZZ')).toThrow(/Invalid URL-encoded/);
  });
});

describe('buildQueryString', () => {
  it('builds simple query', () => {
    expect(buildQueryString({ a: '1', b: '2' })).toBe('a=1&b=2');
  });
  it('encodes special chars in keys and values', () => {
    expect(buildQueryString({ q: 'hello world', tag: 'a&b' })).toBe('q=hello%20world&tag=a%26b');
  });
  it('handles number/boolean values', () => {
    expect(buildQueryString({ n: 42, ok: true })).toBe('n=42&ok=true');
  });
});

describe('parseQueryString', () => {
  it('parses simple query', () => {
    expect(parseQueryString('a=1&b=2')).toEqual({ a: '1', b: '2' });
  });
  it('handles leading ?', () => {
    expect(parseQueryString('?a=1')).toEqual({ a: '1' });
  });
  it('decodes + as space (form encoding)', () => {
    expect(parseQueryString('q=hello+world')).toEqual({ q: 'hello world' });
  });
  it('returns empty for empty input', () => {
    expect(parseQueryString('')).toEqual({});
  });
  it('throws on malformed segment', () => {
    expect(() => parseQueryString('a=%')).toThrow(/Invalid query string/);
  });
});
