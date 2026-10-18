import { describe, expect, it } from 'vitest';
import { findUnsafeIntegers } from '../shared/json-unsafe-integers';
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

// Review 2026-09-05: integers above 2^53 were rounded without a word, and V8's current
// JSON.parse message carries no position, so errors lost their line/col.
describe('unsafe integers', () => {
  it('flags integer literals JSON.parse cannot hold exactly', () => {
    const r = parseJson(
      '{"id": 12345678901234567890, "n": -9007199254740993, "ok": 9007199254740991}',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.unsafeIntegers).toEqual(['12345678901234567890', '-9007199254740993']);
  });
  it('ignores digits inside strings, comments, floats and exponents', () => {
    expect(
      findUnsafeIntegers('{"s": "12345678901234567890", "f": 12345678901234567890.5, "e": 1e30}'),
    ).toEqual([]);
    expect(findUnsafeIntegers('// 12345678901234567890\n{"a": 1}')).toEqual([]);
  });
});

describe('error location', () => {
  it('reports line and column even when the engine message has no position', () => {
    const r = parseJson('{\n"a": 1,\n"b": }');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.line).toBe(3);
      expect(r.error.col).toBeGreaterThan(0);
    }
  });
  it('says when the only problem is JSON5 syntax', () => {
    const r = parseJson('{"a": 1,}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.json5Ok).toBe(true);
  });
});
