import { describe, expect, it } from 'vitest';
import { amortize } from './logic';

describe('amortize (mortgage)', () => {
  it('industry-verified: $320k at 6.5% for 30 years → monthly ≈ $2022.62', () => {
    const r = amortize(320000, 6.5, 30);
    expect(r.monthly).toBeCloseTo(2022.62, 1);
    expect(r.totalInterest).toBeGreaterThan(0);
    // totalPaid = monthly × 360 (using the actual computed monthly, not the rounded display value)
    expect(r.totalPaid).toBeCloseTo(r.monthly * 360, 5);
  });

  it('zero interest rate — equal principal payments', () => {
    const r = amortize(300000, 0, 30);
    expect(r.monthly).toBeCloseTo(300000 / 360, 5);
    expect(r.totalPaid).toBeCloseTo(300000, 5);
    expect(r.totalInterest).toBeCloseTo(0, 5);
  });

  it('shorter term → higher monthly payment, less total interest', () => {
    const r30 = amortize(320000, 6.5, 30);
    const r15 = amortize(320000, 6.5, 15);
    expect(r15.monthly).toBeGreaterThan(r30.monthly);
    expect(r15.totalInterest).toBeLessThan(r30.totalInterest);
  });

  it('higher interest rate → higher monthly and more total interest', () => {
    const r6 = amortize(400000, 6, 30);
    const r8 = amortize(400000, 8, 30);
    expect(r8.monthly).toBeGreaterThan(r6.monthly);
    expect(r8.totalInterest).toBeGreaterThan(r6.totalInterest);
  });

  it('zero years edge case → all zeros', () => {
    const r = amortize(400000, 6.5, 0);
    expect(r.monthly).toBe(0);
    expect(r.totalPaid).toBe(0);
    expect(r.totalInterest).toBe(0);
  });
});
