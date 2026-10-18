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

describe('documented punctuation behaviour', () => {
  // The FAQ describes these exactly; if the slugifier's charmap changes, the copy
  // becomes wrong and this catches it.
  it('keeps "!" unless strict, and drops "?" either way', () => {
    expect(makeSlug('Hello World!! 2026')).toBe('hello-world!!-2026');
    expect(makeSlug('Hello World!! 2026', { strict: true })).toBe('hello-world-2026');
    expect(makeSlug('What? Really!')).toBe('what-really!');
  });

  it('transliterates "&" into "and" rather than deleting it', () => {
    expect(makeSlug('a/b&c')).toBe('abandc');
  });
});
