import { describe, expect, it } from 'vitest';
import { contrastRatio, hexToRgb, luminance, rgbToHex, rgbToHsl } from './logic';

describe('hexToRgb', () => {
  it('parses 6-digit hex', () => {
    expect(hexToRgb('#FF0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#2563EB')).toEqual({ r: 37, g: 99, b: 235 });
  });

  it('parses 3-digit shorthand', () => {
    expect(hexToRgb('#F00')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#0F0')).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('returns null for invalid input', () => {
    expect(hexToRgb('not-a-hex')).toBeNull();
    expect(hexToRgb('#ZZZZZZ')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
  });
});

describe('rgbToHex', () => {
  it('converts rgb to uppercase hex', () => {
    expect(rgbToHex({ r: 255, g: 0, b: 0 })).toBe('#FF0000');
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000');
    expect(rgbToHex({ r: 255, g: 255, b: 255 })).toBe('#FFFFFF');
  });

  it('clamps values outside 0-255', () => {
    expect(rgbToHex({ r: 300, g: -10, b: 128 })).toBe('#FF0080');
  });
});

describe('hex↔rgb round-trip', () => {
  it('preserves color through hex→rgb→hex', () => {
    const colors = ['#FF0000', '#00FF00', '#0000FF', '#2563EB', '#AABBCC'];
    for (const hex of colors) {
      const rgb = hexToRgb(hex)!;
      expect(rgbToHex(rgb)).toBe(hex);
    }
  });
});

describe('rgbToHsl', () => {
  it('pure red → h=0, s=100, l=50', () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 });
  });

  it('pure green → h=120', () => {
    expect(rgbToHsl({ r: 0, g: 255, b: 0 })).toMatchObject({ h: 120 });
  });

  it('pure blue → h=240', () => {
    expect(rgbToHsl({ r: 0, g: 0, b: 255 })).toMatchObject({ h: 240 });
  });

  it('white → l=100, s=0', () => {
    expect(rgbToHsl({ r: 255, g: 255, b: 255 })).toMatchObject({ s: 0, l: 100 });
  });

  it('black → l=0, s=0', () => {
    expect(rgbToHsl({ r: 0, g: 0, b: 0 })).toMatchObject({ s: 0, l: 0 });
  });
});

describe('luminance', () => {
  it('black has luminance 0', () => {
    expect(luminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
  });

  it('white has luminance 1', () => {
    expect(luminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });
});

describe('contrastRatio', () => {
  it('black on white is 21:1', () => {
    const ratio = contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    expect(ratio).toBeCloseTo(21, 0);
  });

  it('same color has ratio 1', () => {
    const red = { r: 255, g: 0, b: 0 };
    expect(contrastRatio(red, red)).toBeCloseTo(1, 5);
  });
});
