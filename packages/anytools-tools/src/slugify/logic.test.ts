import { describe, expect, it } from 'vitest';
import { makeBulkSlugs, makeSlug } from './logic';

describe('makeSlug', () => {
  it('basic ASCII', () => {
    expect(makeSlug('Hello World')).toBe('hello-world');
  });
  it('strips diacritics', () => {
    expect(makeSlug('Café')).toBe('cafe');
  });
  it('Vietnamese with đ', () => {
    expect(makeSlug('Tiếng Việt có dấu', { locale: 'vi' })).toBe('tieng-viet-co-dau');
    expect(makeSlug('Đẹp', { locale: 'vi' })).toBe('dep');
  });
  it('underscore separator', () => {
    expect(makeSlug('hello world', { separator: '_' })).toBe('hello_world');
  });
  it('strict mode strips punctuation', () => {
    expect(makeSlug("don't stop!", { strict: true })).toBe('dont-stop');
  });
});

describe('makeBulkSlugs', () => {
  it('processes line by line', () => {
    expect(makeBulkSlugs('Hello\nWorld\nFoo Bar')).toEqual(['hello', 'world', 'foo-bar']);
  });
  it('skips blank lines', () => {
    expect(makeBulkSlugs('\n\nHello\n\n')).toEqual(['hello']);
  });
});
