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

describe('validateYaml', () => {
  it('valid', () => expect(validateYaml('a: 1\nb: 2').ok).toBe(true));
  it('invalid', () => expect(validateYaml('a:\n  - x\n - y').ok).toBe(false));
});
