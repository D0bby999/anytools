import { describe, expect, it } from 'vitest';
import { computeStats, parseNumbers } from './logic';

describe('computeStats', () => {
  it('returns null for empty array', () => {
    expect(computeStats([], 'sample')).toBeNull();
  });

  it('computes correct mean and sum', () => {
    const s = computeStats([1, 2, 3, 4, 5], 'sample')!;
    expect(s.mean).toBeCloseTo(3);
    expect(s.sum).toBe(15);
    expect(s.n).toBe(5);
  });

  it('computes median for odd-length array', () => {
    const s = computeStats([3, 1, 4, 1, 5], 'sample')!;
    // sorted: [1,1,3,4,5] → median = 3
    expect(s.median).toBe(3);
  });

  it('computes median for even-length array', () => {
    const s = computeStats([1, 2, 3, 4], 'sample')!;
    // sorted: [1,2,3,4] → (2+3)/2 = 2.5
    expect(s.median).toBeCloseTo(2.5);
  });

  it('computes sample variance with n-1 denominator', () => {
    // [2,4,4,4,5,5,7,9]: mean=5, sqDiff=32, sample var = 32/7 ≈ 4.571
    const s = computeStats([2, 4, 4, 4, 5, 5, 7, 9], 'sample')!;
    expect(s.variance).toBeCloseTo(32 / 7);
    expect(s.stdDev).toBeCloseTo(Math.sqrt(32 / 7));
  });

  it('computes population variance with n denominator', () => {
    const s = computeStats([2, 4, 4, 4, 5, 5, 7, 9], 'population')!;
    expect(s.variance).toBeCloseTo(4);
    expect(s.stdDev).toBeCloseTo(2);
  });

  it('computes min, max, range correctly', () => {
    const s = computeStats([4, 8, 15, 16, 23, 42], 'sample')!;
    expect(s.min).toBe(4);
    expect(s.max).toBe(42);
    expect(s.range).toBe(38);
  });

  it('identifies single mode', () => {
    const s = computeStats([1, 2, 2, 3], 'sample')!;
    expect(s.modes).toEqual([2]);
  });

  it('identifies multiple modes', () => {
    const s = computeStats([1, 1, 2, 2, 3], 'sample')!;
    expect(s.modes).toHaveLength(2);
    expect(s.modes).toContain(1);
    expect(s.modes).toContain(2);
  });

  it('computes Q1 and Q3', () => {
    // [1,2,3,4,5,6,7,8]: Q1 at 0.25*(7)=1.75 → 1+0.75*(2-1)=1.75; Q3 at 0.75*(7)=5.25 → 6+0.25*(7-6)=6.25
    const s = computeStats([1, 2, 3, 4, 5, 6, 7, 8], 'sample')!;
    expect(s.q1).toBeCloseTo(2.75);
    expect(s.q3).toBeCloseTo(6.25);
  });
});

describe('parseNumbers', () => {
  it('parses comma-separated numbers', () => {
    expect(parseNumbers('1,2,3')).toEqual([1, 2, 3]);
  });

  it('parses space-separated numbers', () => {
    expect(parseNumbers('4 8 15')).toEqual([4, 8, 15]);
  });

  it('parses mixed delimiters', () => {
    expect(parseNumbers('1, 2; 3\n4')).toEqual([1, 2, 3, 4]);
  });

  it('filters out non-numeric tokens', () => {
    expect(parseNumbers('1, abc, 3')).toEqual([1, 3]);
  });

  it('returns empty array for blank string', () => {
    expect(parseNumbers('')).toEqual([]);
  });
});
