import { describe, expect, it } from 'vitest';
import { escapeUnicode, unescapeUnicode } from './logic';

describe('escapeUnicode', () => {
  it('json mode keeps ASCII printable', () => {
    expect(escapeUnicode('Hello!')).toBe('Hello!');
  });
  it('json mode escapes Vietnamese diacritic', () => {
    expect(escapeUnicode('cà')).toBe('c\\u00e0');
  });
  it('json mode escapes emoji as surrogate pair', () => {
    expect(escapeUnicode('🌏')).toBe('\\ud83c\\udf0f');
  });
  it('es6 mode uses \\u{} for astral codepoints', () => {
    expect(escapeUnicode('🌏', { mode: 'es6' })).toBe('\\u{1f30f}');
  });
  it('all mode escapes ASCII too', () => {
    expect(escapeUnicode('Ab', { mode: 'all' })).toBe('\\u0041\\u0062');
  });
  it('uppercase option', () => {
    expect(escapeUnicode('é', { uppercase: true })).toBe('\\u00E9');
  });
  it('empty input returns empty', () => {
    expect(escapeUnicode('')).toBe('');
  });
});

describe('unescapeUnicode', () => {
  it('unescapes \\uXXXX', () => {
    expect(unescapeUnicode('c\\u00e0')).toBe('cà');
  });
  it('unescapes ES6 \\u{XXXXX}', () => {
    expect(unescapeUnicode('\\u{1f30f}')).toBe('🌏');
  });
  it('combines surrogate pair into emoji', () => {
    expect(unescapeUnicode('\\ud83c\\udf0f')).toBe('🌏');
  });
  it('mixed plain + escapes', () => {
    expect(unescapeUnicode('Hi \\u00e0 world')).toBe('Hi à world');
  });
  it('empty input returns empty', () => {
    expect(unescapeUnicode('')).toBe('');
  });
  it('roundtrip', () => {
    const original = 'Hello 🌏 cà phê! ✨';
    expect(unescapeUnicode(escapeUnicode(original))).toBe(original);
  });
});
