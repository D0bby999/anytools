import { describe, expect, it } from 'vitest';
import { countText } from './logic';

describe('countText', () => {
  it('returns all zeros for empty string', () => {
    const r = countText('');
    expect(r.chars).toBe(0);
    expect(r.charsNoSpaces).toBe(0);
    expect(r.words).toBe(0);
    expect(r.sentences).toBe(0);
    expect(r.paragraphs).toBe(0);
    expect(r.lines).toBe(0);
    expect(r.avgWordLength).toBe(0);
  });

  it('counts chars and chars without spaces', () => {
    const r = countText('hello world');
    expect(r.chars).toBe(11);
    expect(r.charsNoSpaces).toBe(10);
  });

  it('counts words correctly', () => {
    expect(countText('one two three').words).toBe(3);
    // Multiple spaces between words still count as 1 word boundary
    expect(countText('one   two').words).toBe(2);
  });

  it('counts sentences by terminal punctuation', () => {
    expect(countText('Hello! How are you? Fine.').sentences).toBe(3);
  });

  it('counts paragraphs separated by blank lines', () => {
    const text = 'Para one.\n\nPara two.\n\nPara three.';
    expect(countText(text).paragraphs).toBe(3);
  });

  it('counts lines correctly', () => {
    expect(countText('line1\nline2\nline3').lines).toBe(3);
    expect(countText('single').lines).toBe(1);
  });

  it('computes average word length', () => {
    // 'hi' (2) + 'bye' (3) = 5 / 2 = 2.5
    const r = countText('hi bye');
    expect(r.avgWordLength).toBeCloseTo(2.5);
  });

  it('handles whitespace-only text as empty', () => {
    const r = countText('   \n  ');
    expect(r.words).toBe(0);
    expect(r.sentences).toBe(0);
    expect(r.paragraphs).toBe(0);
  });
});
