import { describe, expect, it } from 'vitest';
import { countWords, estimateReadingTime, formatDuration, wordsToSeconds } from './logic';

describe('countWords', () => {
  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });

  it('returns 0 for whitespace-only string', () => {
    expect(countWords('   \n\t  ')).toBe(0);
  });

  it('counts single word', () => {
    expect(countWords('hello')).toBe(1);
  });

  it('counts multiple words separated by varied whitespace', () => {
    expect(countWords('one  two\tthree\nfour')).toBe(4);
  });

  it('ignores leading and trailing whitespace', () => {
    expect(countWords('  hello world  ')).toBe(2);
  });
});

describe('wordsToSeconds', () => {
  it('returns 0 for 0 words', () => {
    expect(wordsToSeconds(0, 238)).toBe(0);
  });

  it('returns 0 for 0 wpm', () => {
    expect(wordsToSeconds(100, 0)).toBe(0);
  });

  it('computes correctly: 238 words at 238 wpm = 60s', () => {
    expect(wordsToSeconds(238, 238)).toBeCloseTo(60);
  });

  it('computes correctly: 150 words at 150 wpm = 60s', () => {
    expect(wordsToSeconds(150, 150)).toBeCloseTo(60);
  });
});

describe('formatDuration', () => {
  it('formats sub-60s as seconds', () => {
    expect(formatDuration(45)).toBe('45s');
  });

  it('formats exact minutes without seconds', () => {
    expect(formatDuration(120)).toBe('2 min');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(90)).toBe('1m 30s');
  });

  it('rounds sub-60 seconds', () => {
    expect(formatDuration(0.4)).toBe('0s');
    expect(formatDuration(59.6)).toBe('60s');
  });
});

describe('estimateReadingTime', () => {
  it('returns all zeros for empty text', () => {
    const r = estimateReadingTime('', 238);
    expect(r.words).toBe(0);
    expect(r.readSeconds).toBe(0);
    expect(r.speakSeconds).toBe(0);
    expect(r.skimSeconds).toBe(0);
  });

  it('speak is slower than skim for same text', () => {
    const r = estimateReadingTime('hello world foo bar baz', 238);
    expect(r.speakSeconds).toBeGreaterThan(r.skimSeconds);
  });

  it('read time varies with wpm', () => {
    const text = 'word '.repeat(300).trim();
    const fast = estimateReadingTime(text, 400);
    const slow = estimateReadingTime(text, 100);
    expect(slow.readSeconds).toBeGreaterThan(fast.readSeconds);
  });
});
