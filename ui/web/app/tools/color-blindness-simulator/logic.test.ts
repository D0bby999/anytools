import { describe, expect, it } from 'vitest';
import { hexToRgb, rgbToHex, simulate, simulateImageData } from './logic';

describe('hexToRgb / rgbToHex', () => {
  it('parses 6-digit and 3-digit hex, with or without #', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('00ff00')).toEqual({ r: 0, g: 255, b: 0 });
    expect(hexToRgb('#00f')).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('rejects invalid hex', () => {
    expect(hexToRgb('not-a-color')).toBeNull();
    expect(hexToRgb('#ff00')).toBeNull();
  });

  it('round-trips back to uppercase 6-digit hex', () => {
    expect(rgbToHex({ r: 255, g: 0, b: 0 })).toBe('#FF0000');
    expect(rgbToHex({ r: 18, g: 52, b: 86 })).toBe('#123456');
  });
});

describe('simulate', () => {
  it('returns the color unchanged when type is null', () => {
    const red = { r: 220, g: 20, b: 20 };
    expect(simulate(red, null)).toEqual(red);
  });

  it('keeps pure white and pure black unchanged by every deficiency', () => {
    // Achromatic colors sit on every dichromat's confusion line trivially — they have no
    // chromatic information to lose, so the round trip through LMS should be a no-op modulo
    // floating point rounding.
    for (const type of ['protanopia', 'deuteranopia', 'tritanopia'] as const) {
      expect(simulate({ r: 255, g: 255, b: 255 }, type)).toEqual({ r: 255, g: 255, b: 255 });
      expect(simulate({ r: 0, g: 0, b: 0 }, type)).toEqual({ r: 0, g: 0, b: 0 });
    }
  });

  it('produces three visibly different results for a saturated red-green pair', () => {
    // The whole point of simulating separate deficiencies: protanopia, deuteranopia and
    // tritanopia must not collapse to the same output for a color chosen to stress red/green
    // confusion.
    const orange = { r: 230, g: 126, b: 34 };
    const pro = simulate(orange, 'protanopia');
    const deu = simulate(orange, 'deuteranopia');
    const tri = simulate(orange, 'tritanopia');
    expect(pro).not.toEqual(deu);
    expect(deu).not.toEqual(tri);
    expect(pro).not.toEqual(tri);
  });

  it('achromatopsia collapses to equal r/g/b (pure luminance)', () => {
    const { r, g, b } = simulate({ r: 200, g: 80, b: 40 }, 'achromatopsia');
    expect(r).toBe(g);
    expect(g).toBe(b);
  });

  it('achromatopsia matches the ITU-R BT.709 luma formula', () => {
    const rgb = { r: 200, g: 80, b: 40 };
    const expected = Math.round(0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b);
    expect(simulate(rgb, 'achromatopsia').r).toBe(expected);
  });

  it('clamps every channel into [0, 255]', () => {
    const result = simulate({ r: 255, g: 0, b: 0 }, 'tritanopia');
    for (const channel of [result.r, result.g, result.b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
  });
});

describe('simulateImageData', () => {
  it('rewrites RGB in place and leaves alpha untouched', () => {
    const data = new Uint8ClampedArray([200, 80, 40, 128, 10, 200, 30, 255]);
    simulateImageData(data, 'achromatopsia');
    expect(data[0]).toBe(data[1]);
    expect(data[1]).toBe(data[2]);
    expect(data[3]).toBe(128); // alpha of pixel 1 untouched
    expect(data[4]).toBe(data[5]);
    expect(data[7]).toBe(255); // alpha of pixel 2 untouched
  });

  it('is a no-op when type is null', () => {
    const data = new Uint8ClampedArray([10, 20, 30, 255]);
    const before = Array.from(data);
    simulateImageData(data, null);
    expect(Array.from(data)).toEqual(before);
  });
});
