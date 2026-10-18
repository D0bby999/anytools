import { describe, expect, it } from 'vitest';
import { calculateTipWage } from './logic';

describe('calculateTipWage', () => {
  it('calculates effective wage with no tip-out', () => {
    const result = calculateTipWage(120, 2.13, 6, 0);
    expect(result.netTips).toBeCloseTo(120);
    expect(result.tipHourly).toBeCloseTo(20);
    expect(result.effective).toBeCloseTo(22.13);
    expect(result.shiftEarnings).toBeCloseTo(132.78);
  });

  it('deducts tip-out percentage from gross tips', () => {
    const result = calculateTipWage(100, 5, 4, 20);
    expect(result.netTips).toBeCloseTo(80);
    expect(result.tipHourly).toBeCloseTo(20);
    expect(result.effective).toBeCloseTo(25);
  });

  it('returns zero tip-hourly when hours is 0', () => {
    const result = calculateTipWage(100, 10, 0, 0);
    expect(result.tipHourly).toBe(0);
    expect(result.effective).toBe(10);
  });

  it('shift earnings equals base * hours + netTips', () => {
    const result = calculateTipWage(60, 3, 5, 10);
    const expectedNetTips = 60 * 0.9;
    const expectedShift = 3 * 5 + expectedNetTips;
    expect(result.shiftEarnings).toBeCloseTo(expectedShift);
  });

  it('handles 100% tip-out (full tip to others)', () => {
    const result = calculateTipWage(200, 7.25, 8, 100);
    expect(result.netTips).toBeCloseTo(0);
    expect(result.tipHourly).toBeCloseTo(0);
    expect(result.effective).toBeCloseTo(7.25);
  });
});
