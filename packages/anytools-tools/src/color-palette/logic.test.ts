import { describe, expect, it } from 'vitest';
import { generatePalette, hexToHsl, hslToHex } from './logic';

describe('hexToHsl', () => {
  it('converts pure red', () => {
    const r = hexToHsl('#FF0000');
    expect(r).not.toBeNull();
    expect(r!.h).toBeCloseTo(0, 0);
    expect(r!.s).toBeCloseTo(100, 0);
    expect(r!.l).toBeCloseTo(50, 0);
  });

  it('converts pure blue', () => {
    const r = hexToHsl('#0000FF');
    expect(r).not.toBeNull();
    expect(r!.h).toBeCloseTo(240, 0);
  });

  it('returns null for invalid hex', () => {
    expect(hexToHsl('not-a-color')).toBeNull();
    expect(hexToHsl('#FFF')).toBeNull(); // 3-char not supported here
  });

  it('round-trips through hslToHex', () => {
    const seed = '#2563EB';
    const hsl = hexToHsl(seed)!;
    expect(hslToHex(hsl.h, hsl.s, hsl.l)).toBe(seed);
  });
});

describe('hslToHex', () => {
  it('handles hue overflow (negative wraps correctly)', () => {
    // hue=-30 should wrap to 330 — must not produce garbage
    const result = hslToHex(-30, 60, 50);
    expect(result).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('handles hue overflow (>360 wraps correctly)', () => {
    const result = hslToHex(390, 60, 50);
    expect(result).toMatch(/^#[0-9A-F]{6}$/);
    // 390 mod 360 = 30, same as hue 30
    expect(result).toBe(hslToHex(30, 60, 50));
  });
});

describe('generatePalette', () => {
  const seed = '#FF0000'; // pure red, h=0

  it('complementary returns 2 colors including the seed', () => {
    const p = generatePalette(seed, 'complementary');
    expect(p).toHaveLength(2);
    expect(p[0]).toBe('#FF0000');
    // complement of red (h=0) is cyan (h=180)
    expect(p[1]).toBe('#00FFFF');
  });

  it('triadic returns 3 colors at 120° intervals', () => {
    const p = generatePalette(seed, 'triadic');
    expect(p).toHaveLength(3);
    // h=0 → red, h=120 → green, h=240 → blue (at full saturation)
    expect(p[0]).toBe('#FF0000');
    expect(p[1]).toBe('#00FF00');
    expect(p[2]).toBe('#0000FF');
  });

  it('tetradic returns 4 colors at 90° intervals', () => {
    const p = generatePalette(seed, 'tetradic');
    expect(p).toHaveLength(4);
  });

  it('analogous returns 5 colors', () => {
    const p = generatePalette(seed, 'analogous');
    expect(p).toHaveLength(5);
    // middle color (index 2, offset=0) is the seed itself
    expect(p[2]).toBe(seed);
  });

  it('monochromatic returns 5 colors all same hue', () => {
    const p = generatePalette(seed, 'monochromatic');
    expect(p).toHaveLength(5);
    // all should have hue ~0 (red family)
    for (const c of p) {
      const hsl = hexToHsl(c)!;
      expect(hsl.h).toBeCloseTo(0, 0);
    }
  });

  it('returns seed unchanged for invalid hex', () => {
    const p = generatePalette('invalid', 'complementary');
    expect(p).toEqual(['invalid']);
  });
});
