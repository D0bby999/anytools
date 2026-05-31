import { describe, expect, it } from 'vitest';
import { calcDiscount, calcStackedDiscounts } from './logic';

describe('calcDiscount', () => {
  it('standard 25% off, no tax', () => {
    const r = calcDiscount(100, 25);
    expect(r.discount).toBeCloseTo(25, 5);
    expect(r.afterDiscount).toBeCloseTo(75, 5);
    expect(r.tax).toBeCloseTo(0, 5);
    expect(r.final).toBeCloseTo(75, 5);
    expect(r.savings).toBeCloseTo(25, 5);
  });

  it('discount + tax: 20% off then 10% tax', () => {
    const r = calcDiscount(200, 20, 10);
    // afterDiscount = 200 * 0.8 = 160; tax = 160 * 0.1 = 16; final = 176
    expect(r.afterDiscount).toBeCloseTo(160, 5);
    expect(r.tax).toBeCloseTo(16, 5);
    expect(r.final).toBeCloseTo(176, 5);
    expect(r.savings).toBeCloseTo(24, 5); // 200 - 176 = 24
  });

  it('zero discount — final equals original', () => {
    const r = calcDiscount(50, 0);
    expect(r.discount).toBeCloseTo(0, 5);
    expect(r.final).toBeCloseTo(50, 5);
    expect(r.savings).toBeCloseTo(0, 5);
  });

  it('100% discount — final is 0', () => {
    const r = calcDiscount(99.99, 100);
    expect(r.final).toBeCloseTo(0, 5);
    expect(r.savings).toBeCloseTo(99.99, 5);
  });

  it('tax with zero discount applies to full price', () => {
    const r = calcDiscount(100, 0, 8.25);
    expect(r.afterDiscount).toBeCloseTo(100, 5);
    expect(r.tax).toBeCloseTo(8.25, 3);
    expect(r.final).toBeCloseTo(108.25, 3);
  });
});

describe('calcStackedDiscounts', () => {
  it('20% then 10% is NOT 30% — sequential application', () => {
    const r = calcStackedDiscounts(100, 20, 10);
    // 100 * 0.8 = 80; 80 * 0.9 = 72
    expect(r.final).toBeCloseTo(72, 5);
    expect(r.savings).toBeCloseTo(28, 5);
  });

  it('0% then 0% — no change', () => {
    const r = calcStackedDiscounts(100, 0, 0);
    expect(r.final).toBeCloseTo(100, 5);
    expect(r.savings).toBeCloseTo(0, 5);
  });

  it('50% then 50% — final is 25% of original', () => {
    const r = calcStackedDiscounts(200, 50, 50);
    expect(r.final).toBeCloseTo(50, 5);
  });
});
