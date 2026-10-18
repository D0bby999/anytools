import { describe, expect, it } from 'vitest';
import { formatYaml, validateYaml } from './logic';

describe('formatYaml', () => {
  it('formats valid YAML', () => {
    const r = formatYaml('b: 2\na: 1\n', 2);
    expect(r.ok).toBe(true);
  });
  it('sorts keys when requested', () => {
    const r = formatYaml('b: 2\na: 1\n', 2, true);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const aIdx = r.value.indexOf('a:');
      const bIdx = r.value.indexOf('b:');
      expect(aIdx).toBeLessThan(bIdx);
    }
  });
  it('rejects invalid YAML', () => {
    const r = formatYaml('a:\n  - x\n - y\n', 2);
    expect(r.ok).toBe(false);
  });
});

// Review 2026-09-05: the js-yaml load/dump round-trip deleted comments, resolved anchors,
// rewrote dates as timestamps and refused multi-document streams.
describe('formatYaml preserves what a formatter must not change', () => {
  it('keeps comments', () => {
    const r = formatYaml('# top\nkey: value # inline\n', 2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('# top\nkey: value # inline\n');
  });
  it('keeps anchors, aliases and merge keys', () => {
    const r = formatYaml('base: &b\n  a: 1\nchild:\n  <<: *b\n  c: 2\n', 2);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toContain('&b');
      expect(r.value).toContain('<<: *b');
    }
  });
  it('leaves dates as the strings they were written as', () => {
    const r = formatYaml('date: 2024-01-01\n', 2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('date: 2024-01-01\n');
  });
  it('formats every document in a multi-document stream', () => {
    const r = formatYaml('a:   1\n---\nb:   2\n', 2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('a: 1\n---\nb: 2\n');
  });
  it('re-indents nested structures', () => {
    const r = formatYaml('a:\n    b:\n        - x\n', 2);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('a:\n  b:\n    - x\n');
  });
});

describe('validateYaml', () => {
  it('valid', () => expect(validateYaml('a: 1\nb: 2').ok).toBe(true));
  it('invalid', () => expect(validateYaml('a:\n  - x\n - y').ok).toBe(false));
});
