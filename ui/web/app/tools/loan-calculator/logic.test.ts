import { describe, expect, it } from 'vitest';
import { amortize } from './logic';

describe('amortize (loan)', () => {
  it('zero interest rate — equal principal payments', () => {
    const r = amortize(12000, 0, 12);
    expect(r.monthly).toBeCloseTo(1000, 5);
    expect(r.total).toBeCloseTo(12000, 5);
    expect(r.interest).toBeCloseTo(0, 5);
  });

  it('known formula: $20k at 8.5% for 60 months', () => {
    // Standard amortization: M = 20000 × [0.007083 × (1.007083)^60] / [(1.007083)^60 − 1] ≈ 410.33
    const r = amortize(20000, 8.5, 60);
    expect(r.monthly).toBeCloseTo(410.33, 0);
    expect(r.total).toBeCloseTo(410.33 * 60, 0);
    expect(r.interest).toBeGreaterThan(0);
  });

  it('higher rate → higher monthly payment and more interest', () => {
    const low = amortize(10000, 3, 36);
    const high = amortize(10000, 15, 36);
    expect(high.monthly).toBeGreaterThan(low.monthly);
    expect(high.interest).toBeGreaterThan(low.interest);
  });

  it('longer term → lower monthly payment but more total interest', () => {
    const short = amortize(10000, 6, 24);
    const long = amortize(10000, 6, 60);
    expect(long.monthly).toBeLessThan(short.monthly);
    expect(long.interest).toBeGreaterThan(short.interest);
  });

  it('zero months edge case → all zeros', () => {
    const r = amortize(10000, 5, 0);
    expect(r.monthly).toBe(0);
    expect(r.total).toBe(0);
    expect(r.interest).toBe(0);
  });
});
