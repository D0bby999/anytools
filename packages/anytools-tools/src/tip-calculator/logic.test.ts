import { describe, expect, it } from 'vitest';
import { calculateTip } from './logic';

describe('calculateTip', () => {
  it('calculates tip, total, and per-person for standard case', () => {
    const result = calculateTip(100, 20, 4);
    expect(result.tip).toBeCloseTo(20);
    expect(result.total).toBeCloseTo(120);
    expect(result.perPerson).toBeCloseTo(30);
  });

  it('splits correctly for 1 person', () => {
    const result = calculateTip(50, 18, 1);
    expect(result.tip).toBeCloseTo(9);
    expect(result.total).toBeCloseTo(59);
    expect(result.perPerson).toBeCloseTo(59);
  });

  it('clamps people to 1 when 0 is passed (no division by zero)', () => {
    const result = calculateTip(100, 10, 0);
    expect(result.perPerson).toBeCloseTo(110);
  });

  it('returns zero tip for 0% tip percentage', () => {
    const result = calculateTip(80, 0, 2);
    expect(result.tip).toBe(0);
    expect(result.total).toBe(80);
    expect(result.perPerson).toBeCloseTo(40);
  });

  it('handles fractional bill and tip', () => {
    const result = calculateTip(33.33, 15, 3);
    expect(result.tip).toBeCloseTo(4.9995);
    expect(result.total).toBeCloseTo(38.3295);
    expect(result.perPerson).toBeCloseTo(12.7765);
  });
});
