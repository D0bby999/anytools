import { describe, expect, it } from 'vitest';
import { beautifyJs, minifyJs } from './logic';

describe('beautifyJs', () => {
  it('formats a function with proper indent', () => {
    const out = beautifyJs('function add(a,b){return a+b;}');
    expect(out).toContain('function add(a, b) {');
    expect(out).toContain('  return a + b;');
  });
  it('respects custom indent', () => {
    const out = beautifyJs('if(x){y()}', { indentSize: 4 });
    expect(out).toContain('    y()');
  });
  it('empty input returns empty', () => {
    expect(beautifyJs('')).toBe('');
  });
});

describe('minifyJs', () => {
  it('mangles names and removes whitespace', async () => {
    const result = await minifyJs('function add(first, second) { return first + second; }');
    expect(result.code).toContain('function');
    expect(result.code.length).toBeLessThan(60);
    expect(result.sizeAfter).toBeLessThan(result.sizeBefore);
  });

  it('preserves syntax when compress=false', async () => {
    const result = await minifyJs('const x = 1 + 1;', { compress: false });
    expect(result.code).toContain('1+1');
  });

  it('compresses 1+1 to 2 by default', async () => {
    const result = await minifyJs('const x = 1 + 1; console.log(x);');
    expect(result.code).toContain('2');
  });

  it('empty input returns empty', async () => {
    const result = await minifyJs('');
    expect(result.code).toBe('');
    expect(result.sizeBefore).toBe(0);
  });
});
