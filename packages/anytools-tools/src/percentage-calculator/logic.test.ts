import { describe, expect, it } from 'vitest';
import { calcPercent, percentChange, percentOf, whatPercent } from './logic';

describe('percentOf', () => {
  it('20% of 150 = 30', () => {
    expect(percentOf(20, 150)).toBeCloseTo(30);
  });

  it('0% of anything = 0', () => {
    expect(percentOf(0, 500)).toBe(0);
  });

  it('100% of value = value', () => {
    expect(percentOf(100, 99)).toBeCloseTo(99);
  });

  it('handles fractional percentages', () => {
    expect(percentOf(12.5, 200)).toBeCloseTo(25);
  });
});

describe('whatPercent', () => {
  it('30 is 20% of 150', () => {
    expect(whatPercent(30, 150)).toBeCloseTo(20);
  });

  it('returns 0 when denominator is 0', () => {
    expect(whatPercent(50, 0)).toBe(0);
  });

  it('50 is 50% of 100', () => {
    expect(whatPercent(50, 100)).toBeCloseTo(50);
  });
});

describe('percentChange', () => {
  it('100 → 150 = +50%', () => {
    expect(percentChange(100, 150)).toBeCloseTo(50);
  });

  it('150 → 100 = -33.33%', () => {
    expect(percentChange(150, 100)).toBeCloseTo(-33.333, 2);
  });

  it('returns 0 when from is 0', () => {
    expect(percentChange(0, 100)).toBe(0);
  });

  it('no change = 0%', () => {
    expect(percentChange(200, 200)).toBe(0);
  });
});

describe('calcPercent', () => {
  it('percentOf mode returns correct value and empty unit', () => {
    const r = calcPercent('percentOf', 20, 150);
    expect(r.value).toBeCloseTo(30);
    expect(r.unit).toBe('');
    expect(r.label).toContain('20%');
  });

  it('whatPercent mode returns % unit', () => {
    const r = calcPercent('whatPercent', 30, 150);
    expect(r.value).toBeCloseTo(20);
    expect(r.unit).toBe('%');
  });

  it('change mode returns % unit and correct sign', () => {
    const r = calcPercent('change', 100, 50);
    expect(r.value).toBeCloseTo(-50);
    expect(r.unit).toBe('%');
  });
});
