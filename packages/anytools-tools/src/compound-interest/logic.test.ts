import { describe, expect, it } from 'vitest';
import { calcCompoundInterest } from './logic';

describe('calcCompoundInterest', () => {
  it('zero rate — balance equals principal plus all contributions', () => {
    const result = calcCompoundInterest(10000, 0, 0, 10);
    expect(result.balance).toBeCloseTo(10000, 2);
    expect(result.totalContributed).toBeCloseTo(10000, 2);
    expect(result.interest).toBeCloseTo(0, 2);
  });

  it('zero rate with contributions — simple sum', () => {
    // 0% rate, $100/mo for 12 months, $0 principal
    const result = calcCompoundInterest(0, 100, 0, 1);
    expect(result.balance).toBeCloseTo(1200, 2);
    expect(result.totalContributed).toBeCloseTo(1200, 2);
    expect(result.interest).toBeCloseTo(0, 2);
  });

  it('known formula: A = P(1 + r/n)^(nt) for principal-only (no contributions)', () => {
    // P=1000, r=12% annual, n=12 (monthly), t=1 year → A = 1000*(1+0.01)^12 ≈ 1126.83
    const result = calcCompoundInterest(1000, 0, 12, 1);
    expect(result.balance).toBeCloseTo(1126.83, 1);
    expect(result.interest).toBeCloseTo(126.83, 1);
  });

  it('contributions only (no principal) — FV annuity formula', () => {
    // PMT=100, r=6%/yr, 1 year monthly → FV = 100 × [((1+0.005)^12 - 1) / 0.005] ≈ 1233.56
    const result = calcCompoundInterest(0, 100, 6, 1);
    expect(result.balance).toBeCloseTo(1233.56, 1);
  });

  it('combined: principal + contributions over 20 years at 7%', () => {
    // Default UI values: principal=10000, monthly=200, 7%, 20yr
    const result = calcCompoundInterest(10000, 200, 7, 20);
    expect(result.balance).toBeGreaterThan(result.totalContributed);
    expect(result.interest).toBeGreaterThan(0);
    // Computed: FV_principal = 10000*(1+0.07/12)^240 ≈ 40,387
    //           FV_contrib   = 200*((1.005833^240-1)/0.005833) ≈ 104,185 → total ≈ 144,572
    expect(result.balance).toBeCloseTo(144_572, -1);
    expect(result.totalContributed).toBeCloseTo(10000 + 200 * 240, 0); // 58000
  });
});
