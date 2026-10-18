import { describe, expect, it } from 'vitest';
import { calcRetirement } from './logic';

describe('calcRetirement', () => {
  it('already at retirement age — balance equals current savings (no growth period)', () => {
    const r = calcRetirement(50000, 500, 65, 65, 7);
    expect(r.years).toBe(0);
    expect(r.balance).toBeCloseTo(50000, 2);
    expect(r.interest).toBeCloseTo(0, 2);
    expect(r.safe4pct).toBeCloseTo(50000 * 0.04, 2);
  });

  it('zero rate — balance equals principal plus all contributions', () => {
    const r = calcRetirement(10000, 100, 30, 40, 0);
    // 10 years = 120 months → totalContributed = 10000 + 100*120 = 22000
    expect(r.years).toBe(10);
    expect(r.totalContributed).toBeCloseTo(22000, 2);
    expect(r.balance).toBeCloseTo(22000, 2);
    expect(r.interest).toBeCloseTo(0, 2);
  });

  it('FV annuity: contributions only (no initial savings) at 6% over 1 year', () => {
    // PMT=100, r=6%/yr, 1yr monthly → FV ≈ 1233.56
    const r = calcRetirement(0, 100, 30, 31, 6);
    expect(r.balance).toBeCloseTo(1233.56, 1);
  });

  it('4% safe-withdrawal rule = balance × 0.04', () => {
    const r = calcRetirement(25000, 500, 30, 65, 7);
    expect(r.safe4pct).toBeCloseTo(r.balance * 0.04, 5);
  });

  it('default UI values produce realistic retirement balance', () => {
    // currentSavings=25000, monthly=500, age 30→65, 7% → ~$1.2M range
    const r = calcRetirement(25000, 500, 30, 65, 7);
    expect(r.balance).toBeGreaterThan(1_000_000);
    expect(r.interest).toBeGreaterThan(r.totalContributed);
    expect(r.years).toBe(35);
  });
});
