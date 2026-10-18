import { describe, expect, it } from 'vitest';
import { diffStats, diffText, generatePatch } from './logic';

describe('diffText', () => {
  it('line diff detects added line', () => {
    const changes = diffText('a\nb\n', 'a\nb\nc\n', 'line');
    expect(changes.some((c) => c.added && c.value.includes('c'))).toBe(true);
  });
  it('word diff detects changed word', () => {
    const changes = diffText('hello world', 'hello there', 'word');
    expect(changes.some((c) => c.removed && c.value.includes('world'))).toBe(true);
    expect(changes.some((c) => c.added && c.value.includes('there'))).toBe(true);
  });
  it('char diff', () => {
    const changes = diffText('abc', 'axc', 'char');
    expect(changes.length).toBeGreaterThan(1);
  });
});

describe('diffStats', () => {
  it('counts added/removed/unchanged', () => {
    const stats = diffStats(diffText('a\nb\n', 'a\nc\n', 'line'));
    expect(stats.added).toBeGreaterThan(0);
    expect(stats.removed).toBeGreaterThan(0);
  });
});

describe('generatePatch', () => {
  it('produces unified diff', () => {
    const patch = generatePatch('a\nb\n', 'a\nc\n');
    expect(patch).toContain('@@');
    expect(patch).toContain('-b');
    expect(patch).toContain('+c');
  });
});
