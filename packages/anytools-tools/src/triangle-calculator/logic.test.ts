import { describe, expect, it } from 'vitest';
import { solveSSS } from './logic';

describe('solveSSS — invalid inputs', () => {
  it('returns null for zero sides', () => {
    expect(solveSSS(0, 4, 5)).toBeNull();
    expect(solveSSS(3, 0, 5)).toBeNull();
  });

  it('returns null for negative sides', () => {
    expect(solveSSS(-1, 4, 5)).toBeNull();
  });

  it('returns null when triangle inequality is violated', () => {
    expect(solveSSS(1, 2, 10)).toBeNull();
    expect(solveSSS(1, 1, 2)).toBeNull(); // degenerate: a+b = c
  });
});

describe('solveSSS — 3-4-5 right triangle', () => {
  const r = solveSSS(3, 4, 5)!;

  it('computes correct area', () => {
    expect(r.area).toBeCloseTo(6, 5);
  });

  it('computes correct perimeter', () => {
    expect(r.perimeter).toBeCloseTo(12, 5);
  });

  it('detects right angle', () => {
    expect(r.isRight).toBe(true);
  });

  it('angles sum to 180', () => {
    expect(r.angleA + r.angleB + r.angleC).toBeCloseTo(180, 5);
  });

  it('classifies as scalene', () => {
    expect(r.classification).toBe('scalene');
  });
});

describe('solveSSS — equilateral triangle', () => {
  const r = solveSSS(5, 5, 5)!;

  it('all angles are 60°', () => {
    expect(r.angleA).toBeCloseTo(60, 3);
    expect(r.angleB).toBeCloseTo(60, 3);
    expect(r.angleC).toBeCloseTo(60, 3);
  });

  it('classifies as equilateral', () => {
    expect(r.classification).toBe('equilateral');
  });

  it('is not right', () => {
    expect(r.isRight).toBe(false);
  });
});

describe('solveSSS — isosceles triangle', () => {
  const r = solveSSS(5, 5, 8)!;

  it('classifies as isosceles', () => {
    expect(r.classification).toBe('isosceles');
  });

  it('has correct perimeter', () => {
    expect(r.perimeter).toBeCloseTo(18, 5);
  });
});

describe('solveSSS — area via Heron matches base×height/2', () => {
  it('right triangle with legs 6 and 8 has area 24', () => {
    const r = solveSSS(6, 8, 10)!;
    expect(r.area).toBeCloseTo(24, 5);
  });
});
