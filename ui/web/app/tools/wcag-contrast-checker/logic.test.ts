import { describe, expect, it } from 'vitest';
import { contrastRatio, parseHex, rateContrast, suggestForeground, toHex } from './logic';

describe('parseHex', () => {
  it('parses #rrggbb and #rgb', () => {
    expect(parseHex('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHex('#1a2b3c')).toEqual({ r: 26, g: 43, b: 60 });
  });
  it('rejects invalid input', () => {
    expect(parseHex('#12')).toBeNull();
    expect(parseHex('zzzzzz')).toBeNull();
    expect(parseHex('')).toBeNull();
  });
});

describe('contrastRatio', () => {
  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 255, g: 255, b: 255 };
  it('black on white is 21:1', () => {
    expect(contrastRatio(black, white)).toBeCloseTo(21, 1);
  });
  it('is symmetric', () => {
    const a = parseHex('#336699');
    const b = parseHex('#ffcc00');
    expect(contrastRatio(a as never, b as never)).toBeCloseTo(
      contrastRatio(b as never, a as never),
      6,
    );
  });
  it('same color is 1:1', () => {
    expect(contrastRatio(white, white)).toBeCloseTo(1, 6);
  });
});

describe('rateContrast', () => {
  it('rates the WCAG thresholds', () => {
    expect(rateContrast(4.6)).toMatchObject({ aaNormal: true, aaaNormal: false, aaaLarge: true });
    expect(rateContrast(3.2)).toMatchObject({ aaNormal: false, aaLarge: true });
    expect(rateContrast(7.1)).toMatchObject({ aaaNormal: true });
  });
});

describe('suggestForeground', () => {
  it('returns the input unchanged when it already passes', () => {
    const fg = parseHex('#000000');
    const bg = parseHex('#ffffff');
    expect(suggestForeground(fg as never, bg as never, 4.5)).toEqual(fg);
  });
  it('suggests a passing color for a failing pair', () => {
    const fg = parseHex('#777777');
    const bg = parseHex('#888888');
    const suggested = suggestForeground(fg as never, bg as never, 4.5);
    expect(suggested).not.toBeNull();
    expect(contrastRatio(suggested as never, bg as never)).toBeGreaterThanOrEqual(4.5);
  });
  it('roundtrips through hex without dropping below target', () => {
    const fg = parseHex('#10b981');
    const bg = parseHex('#f8fafc');
    const suggested = suggestForeground(fg as never, bg as never, 4.5) as { r: number };
    const reparsed = parseHex(toHex(suggested as never));
    expect(contrastRatio(reparsed as never, bg as never)).toBeGreaterThanOrEqual(4.5);
  });
});
