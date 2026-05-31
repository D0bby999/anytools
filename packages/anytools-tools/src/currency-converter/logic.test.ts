import { describe, expect, it } from 'vitest';
import { convertCurrency, extractRate } from './logic';

// Fixed rate map — no network calls
const BASE = 'USD';
const RATES: Record<string, number> = {
  EUR: 0.92,
  GBP: 0.79,
  JPY: 149.5,
  USD: 1.0,
};

describe('convertCurrency', () => {
  it('same currency returns the original amount unchanged', () => {
    expect(convertCurrency(100, 'USD', 'USD', RATES, BASE)).toBe(100);
  });

  it('converts USD → EUR using direct rate', () => {
    // 100 USD × 0.92 = 92 EUR
    expect(convertCurrency(100, 'USD', 'EUR', RATES, BASE)).toBeCloseTo(92, 5);
  });

  it('converts USD → JPY using direct rate', () => {
    expect(convertCurrency(1, 'USD', 'JPY', RATES, BASE)).toBeCloseTo(149.5, 5);
  });

  it('cross-rate: EUR → GBP (not base)', () => {
    // EUR→USD = 1/0.92; USD→GBP = 0.79 → rate = 0.79/0.92 ≈ 0.8587
    const expected = (100 / 0.92) * 0.79;
    expect(convertCurrency(100, 'EUR', 'GBP', RATES, BASE)).toBeCloseTo(expected, 4);
  });

  it('returns null when target rate is missing', () => {
    expect(convertCurrency(100, 'USD', 'XYZ', RATES, BASE)).toBeNull();
  });

  it('returns null when source rate is missing (cross rate)', () => {
    expect(convertCurrency(100, 'XYZ', 'EUR', RATES, BASE)).toBeNull();
  });
});

describe('extractRate', () => {
  it('returns 1 for same currency', () => {
    expect(extractRate('EUR', 'EUR', RATES, BASE)).toBe(1);
  });

  it('returns direct rate from base', () => {
    expect(extractRate('USD', 'EUR', RATES, BASE)).toBeCloseTo(0.92, 5);
  });

  it('returns cross rate between two non-base currencies', () => {
    const expected = RATES['GBP']! / RATES['EUR']!;
    expect(extractRate('EUR', 'GBP', RATES, BASE)).toBeCloseTo(expected, 5);
  });

  it('returns null for unknown currency', () => {
    expect(extractRate('USD', 'XXX', RATES, BASE)).toBeNull();
  });
});
