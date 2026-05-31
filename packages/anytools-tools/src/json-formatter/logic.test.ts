import { describe, expect, it } from 'vitest';
import { formatJson, minifyJson, parseJson, sortJsonKeys } from './logic';

describe('parseJson strict', () => {
  it('parses valid JSON', () => {
    const r = parseJson('{"a":1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1 });
  });

  it('rejects trailing comma', () => {
    const r = parseJson('{"a":1,}');
    expect(r.ok).toBe(false);
  });

  it('rejects comments', () => {
    const r = parseJson('{"a":1 /* comment */}');
    expect(r.ok).toBe(false);
  });

  it('reports error message on syntax error', () => {
    const r = parseJson('{\n  "a": ,\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message.length).toBeGreaterThan(0);
  });
});

describe('parseJson forgiving (JSON5)', () => {
  it('accepts trailing comma', () => {
    const r = parseJson('{"a":1,}', 'forgiving');
    expect(r.ok).toBe(true);
  });
  it('accepts single quotes', () => {
    const r = parseJson("{'a':1}", 'forgiving');
    expect(r.ok).toBe(true);
  });
  it('accepts comments', () => {
    const r = parseJson('{"a":1 /* hi */}', 'forgiving');
    expect(r.ok).toBe(true);
  });
});

describe('formatJson', () => {
  it('pretty-prints with 2-space default', () => {
    expect(formatJson({ a: 1, b: [2, 3] })).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  });
  it('respects custom indent', () => {
    expect(formatJson({ a: 1 }, 4)).toBe('{\n    "a": 1\n}');
  });
  it('respects tab indent', () => {
    expect(formatJson({ a: 1 }, '\t')).toBe('{\n\t"a": 1\n}');
  });
});

describe('minifyJson', () => {
  it('removes whitespace', () => {
    expect(minifyJson({ a: 1, b: { c: 2 } })).toBe('{"a":1,"b":{"c":2}}');
  });
});

describe('sortJsonKeys', () => {
  it('sorts top-level keys', () => {
    expect(sortJsonKeys({ b: 2, a: 1 })).toEqual({ a: 1, b: 2 });
  });
  it('sorts nested keys (deep)', () => {
    const sorted = sortJsonKeys({ b: { y: 2, x: 1 }, a: 1 }) as Record<string, unknown>;
    expect(Object.keys(sorted)).toEqual(['a', 'b']);
    expect(Object.keys(sorted.b as object)).toEqual(['x', 'y']);
  });
  it('shallow mode does not recurse', () => {
    const shallow = sortJsonKeys({ b: { y: 2, x: 1 }, a: 1 }, false) as Record<string, unknown>;
    expect(Object.keys(shallow.b as object)).toEqual(['y', 'x']);
  });
  it('preserves array order', () => {
    expect(sortJsonKeys([3, 1, 2])).toEqual([3, 1, 2]);
  });
});
