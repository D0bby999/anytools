import { describe, expect, it } from 'vitest';
import { calculateBmi, categorize } from './logic';

describe('calculateBmi', () => {
  it('returns 0 for zero height', () => {
    expect(calculateBmi(70, 0)).toBe(0);
  });

  it('returns 0 for zero weight', () => {
    expect(calculateBmi(0, 170)).toBe(0);
  });

  it('computes BMI = w / (h/100)²', () => {
    // 70 kg, 175 cm → 70 / 1.75² = 70 / 3.0625 ≈ 22.86
    expect(calculateBmi(70, 175)).toBeCloseTo(22.86, 1);
  });

  it('computes known obese value', () => {
    // 120 kg, 170 cm → 120 / 1.7² = 120 / 2.89 ≈ 41.5
    expect(calculateBmi(120, 170)).toBeCloseTo(41.5, 0);
  });
});

describe('categorize', () => {
  it('underweight — below 18.5', () => {
    expect(categorize(17)).toBe('underweight');
    expect(categorize(18.4)).toBe('underweight');
  });

  it('normal — 18.5 to <25', () => {
    expect(categorize(18.5)).toBe('normal');
    expect(categorize(22)).toBe('normal');
    expect(categorize(24.9)).toBe('normal');
  });

  it('overweight — 25 to <30', () => {
    expect(categorize(25)).toBe('overweight');
    expect(categorize(27)).toBe('overweight');
    expect(categorize(29.9)).toBe('overweight');
  });

  it('obese-1 — 30 to <35', () => {
    expect(categorize(30)).toBe('obese-1');
    expect(categorize(34.9)).toBe('obese-1');
  });

  it('obese-2 — 35 to <40', () => {
    expect(categorize(35)).toBe('obese-2');
    expect(categorize(39.9)).toBe('obese-2');
  });

  it('obese-3 — 40 and above', () => {
    expect(categorize(40)).toBe('obese-3');
    expect(categorize(50)).toBe('obese-3');
  });
});
