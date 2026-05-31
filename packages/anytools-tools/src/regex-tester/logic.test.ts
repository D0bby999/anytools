import { describe, expect, it } from 'vitest';
import { buildRegex, replaceRegex, testRegex } from './logic';

const ALL_OFF = {
  global: false,
  ignoreCase: false,
  multiline: false,
  dotAll: false,
  unicode: false,
  sticky: false,
};

describe('buildRegex', () => {
  it('builds valid regex', () => {
    expect(buildRegex('\\d+', { ...ALL_OFF, global: true })).toEqual({ ok: true, re: /\d+/g });
  });
  it('reports invalid pattern', () => {
    const r = buildRegex('[a-', ALL_OFF);
    expect(r.ok).toBe(false);
  });
});

describe('testRegex', () => {
  it('finds all global matches', () => {
    const r = testRegex('\\d+', { ...ALL_OFF, global: true }, 'abc123def456');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.matches.map((m) => m.match)).toEqual(['123', '456']);
      expect(r.matches.map((m) => m.index)).toEqual([3, 9]);
    }
  });

  it('captures groups', () => {
    const r = testRegex('(\\w+)=(\\d+)', { ...ALL_OFF, global: true }, 'a=1 b=2');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.matches[0]?.groups).toEqual(['a', '1']);
      expect(r.matches[1]?.groups).toEqual(['b', '2']);
    }
  });

  it('captures named groups', () => {
    const r = testRegex('(?<year>\\d{4})-(?<month>\\d{2})', ALL_OFF, '2026-05');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.matches[0]?.namedGroups).toEqual({ year: '2026', month: '05' });
  });

  it('returns empty matches when none', () => {
    const r = testRegex('xyz', { ...ALL_OFF, global: true }, 'abcdef');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.matches).toEqual([]);
  });

  it('catches invalid regex', () => {
    const r = testRegex('[a-', ALL_OFF, 'anything');
    expect(r.ok).toBe(false);
  });

  it('respects ignoreCase flag', () => {
    const r = testRegex(
      'hello',
      { ...ALL_OFF, global: true, ignoreCase: true },
      'Hello HELLO hello',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.matches).toHaveLength(3);
  });
});

describe('replaceRegex', () => {
  it('replaces with literal string', () => {
    const r = replaceRegex('foo', { ...ALL_OFF, global: true }, 'foo bar foo', 'baz');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toBe('baz bar baz');
  });

  it('uses capture references in replacement', () => {
    const r = replaceRegex('(\\w+)@', { ...ALL_OFF, global: true }, 'a@x.com b@y.com', '<$1>@');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toBe('<a>@x.com <b>@y.com');
  });
});
