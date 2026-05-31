import { describe, expect, it } from 'vitest';
import { addTax, calcSalesTax, removeTax } from './logic';

describe('addTax', () => {
  it('adds 8.25% tax to $100', () => {
    const r = addTax(100, 8.25);
    expect(r.pretax).toBeCloseTo(100, 5);
    expect(r.tax).toBeCloseTo(8.25, 5);
    expect(r.total).toBeCloseTo(108.25, 5);
  });

  it('zero rate — total equals pretax', () => {
    const r = addTax(50, 0);
    expect(r.tax).toBeCloseTo(0, 5);
    expect(r.total).toBeCloseTo(50, 5);
  });

  it('total = subtotal × (1 + rate/100)', () => {
    const r = addTax(200, 10);
    expect(r.total).toBeCloseTo(200 * 1.1, 5);
  });
});

describe('removeTax', () => {
  it('back-calculates pre-tax from tax-inclusive $108.25 at 8.25%', () => {
    const r = removeTax(108.25, 8.25);
    expect(r.pretax).toBeCloseTo(100, 2);
    expect(r.tax).toBeCloseTo(8.25, 2);
    expect(r.total).toBeCloseTo(108.25, 5);
  });

  it('zero rate — pretax equals total', () => {
    const r = removeTax(75, 0);
    expect(r.pretax).toBeCloseTo(75, 5);
    expect(r.tax).toBeCloseTo(0, 5);
  });

  it('round-trip: addTax then removeTax recovers original amount', () => {
    const added = addTax(99.99, 7.5);
    const removed = removeTax(added.total, 7.5);
    expect(removed.pretax).toBeCloseTo(99.99, 4);
  });
});

describe('calcSalesTax (dispatcher)', () => {
  it('mode=add delegates to addTax', () => {
    const r = calcSalesTax(100, 10, 'add');
    expect(r.total).toBeCloseTo(110, 5);
  });

  it('mode=remove delegates to removeTax', () => {
    const r = calcSalesTax(110, 10, 'remove');
    expect(r.pretax).toBeCloseTo(100, 5);
  });
});
