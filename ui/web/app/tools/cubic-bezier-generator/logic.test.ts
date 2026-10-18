import { describe, expect, it } from 'vitest';
import {
  clampControlPoint,
  clampX,
  easingValueAt,
  parseCoordinate,
  toCss,
  toCssVariable,
  toTransitionTimingFunction,
} from './logic';

describe('toCss', () => {
  it('matches the MDN cubic-bezier() text for the "ease" keyword', () => {
    expect(toCss({ x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 })).toBe('cubic-bezier(0.25, 0.1, 0.25, 1)');
  });

  it('trims trailing zeros and keeps three decimals of precision', () => {
    expect(toCss({ x1: 0, y1: 0, x2: 1, y2: 1 })).toBe('cubic-bezier(0, 0, 1, 1)');
    expect(toCss({ x1: 0.1234, y1: 0, x2: 1, y2: 1 })).toBe('cubic-bezier(0.123, 0, 1, 1)');
  });

  it('does not clamp y outside [0, 1] — CSS allows overshoot on that axis', () => {
    expect(toCss({ x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 })).toBe(
      'cubic-bezier(0.34, 1.56, 0.64, 1)',
    );
  });
});

describe('toTransitionTimingFunction / toCssVariable', () => {
  it('wraps the declaration with the right property/variable name', () => {
    const b = { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 };
    expect(toTransitionTimingFunction(b)).toBe(
      'transition-timing-function: cubic-bezier(0.25, 0.1, 0.25, 1);',
    );
    expect(toCssVariable('ease-brand', b)).toBe('--ease-brand: cubic-bezier(0.25, 0.1, 0.25, 1);');
  });
});

describe('clampX', () => {
  it('clamps into [0, 1] — the one axis CSS restricts', () => {
    expect(clampX(-0.5)).toBe(0);
    expect(clampX(1.5)).toBe(1);
    expect(clampX(0.42)).toBe(0.42);
  });
});

describe('clampControlPoint', () => {
  it('clamps x but leaves y untouched, including far outside [0, 1]', () => {
    expect(clampControlPoint({ x: 1.8, y: 2.5 })).toEqual({ x: 1, y: 2.5 });
    expect(clampControlPoint({ x: -0.3, y: -1.9 })).toEqual({ x: 0, y: -1.9 });
  });
});

describe('easingValueAt', () => {
  it('always starts at 0 and ends at 1, for any bezier', () => {
    const beziers = [
      { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 },
      { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 },
      { x1: 0.36, y1: 0, x2: 0.66, y2: -0.56 },
    ];
    for (const b of beziers) {
      expect(easingValueAt(0, b)).toBeCloseTo(0, 6);
      expect(easingValueAt(1, b)).toBeCloseTo(1, 6);
    }
  });

  it('is exactly linear for the (0,0,1,1) control points', () => {
    const linear = { x1: 0, y1: 0, x2: 1, y2: 1 };
    expect(easingValueAt(0.25, linear)).toBeCloseTo(0.25, 6);
    expect(easingValueAt(0.5, linear)).toBeCloseTo(0.5, 6);
    expect(easingValueAt(0.75, linear)).toBeCloseTo(0.75, 6);
  });

  it('overshoots past 1 mid-animation for an ease-out-back curve', () => {
    const backOut = { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 };
    const values = Array.from({ length: 21 }, (_, i) => easingValueAt(i / 20, backOut));
    expect(Math.max(...values)).toBeGreaterThan(1);
  });

  it('dips below 0 near the start for an ease-in-back curve', () => {
    const backIn = { x1: 0.36, y1: 0, x2: 0.66, y2: -0.56 };
    const values = Array.from({ length: 21 }, (_, i) => easingValueAt(i / 20, backIn));
    expect(Math.min(...values)).toBeLessThan(0);
  });

  it('clamps t outside [0, 1] to the curve endpoints', () => {
    const ease = { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 };
    expect(easingValueAt(-1, ease)).toBeCloseTo(easingValueAt(0, ease), 6);
    expect(easingValueAt(2, ease)).toBeCloseTo(easingValueAt(1, ease), 6);
  });
});

describe('parseCoordinate', () => {
  it('parses finite numbers and rejects blank/invalid text', () => {
    expect(parseCoordinate('0.42')).toBe(0.42);
    expect(parseCoordinate('-1.2')).toBe(-1.2);
    expect(parseCoordinate('')).toBeNull();
    expect(parseCoordinate('  ')).toBeNull();
    expect(parseCoordinate('abc')).toBeNull();
  });
});
