// compressPdf itself needs pdf-lib's real object graph plus createImageBitmap/canvas, neither of
// which happy-dom provides (getContext('2d') returns null; there is no Playwright in this repo).
// The pure arithmetic that decides HOW MUCH to shrink an image is what actually determines
// whether the tool hits its size-reduction gate, so that is what is tested here — the full
// pipeline (pdf-lib load → recompress → save, on a real scanned PDF) is verified in the browser
// lane; see the phase's Verify notes for the measured before/after numbers.
import { describe, expect, it } from 'vitest';
import { dpiCappedSize, isGrayColorSpaceName } from './logic';

describe('dpiCappedSize', () => {
  it('shrinks a 300 DPI scan down to a 150 DPI cap', () => {
    // US Letter, 612×792 pt, scanned at ~300 DPI: 2550×3300 px.
    const r = dpiCappedSize(2550, 3300, 612, 792, 150);
    expect(r.width).toBeLessThan(2550);
    expect(r.height).toBeLessThan(3300);
    // Within a pixel of the exact 150 DPI target (612/72*150 = 1275).
    expect(r.width).toBeGreaterThanOrEqual(1274);
    expect(r.width).toBeLessThanOrEqual(1276);
    // Aspect ratio preserved.
    expect(r.height / r.width).toBeCloseTo(3300 / 2550, 2);
  });

  it('never enlarges an image already under the cap', () => {
    const r = dpiCappedSize(800, 600, 612, 792, 300);
    expect(r).toEqual({ width: 800, height: 600 });
  });

  it('caps to the tighter of width/height so nothing overshoots the page', () => {
    // A very wide page relative to the image — height is the binding constraint.
    const r = dpiCappedSize(1000, 1000, 2000, 100, 72);
    const maxH = Math.round((100 / 72) * 72);
    expect(r.height).toBeLessThanOrEqual(maxH + 1);
  });

  it('never returns a zero or negative dimension for a tiny cap', () => {
    const r = dpiCappedSize(5000, 5000, 612, 792, 1);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });

  it('keeps the aspect ratio of a non-square image', () => {
    const r = dpiCappedSize(4000, 1000, 612, 792, 72);
    expect(r.height / r.width).toBeCloseTo(1000 / 4000, 2);
  });
});

describe('isGrayColorSpaceName', () => {
  it('recognises DeviceGray and CalGray', () => {
    expect(isGrayColorSpaceName('/DeviceGray')).toBe(true);
    expect(isGrayColorSpaceName('/CalGray')).toBe(true);
  });

  it('treats everything else as not grayscale, including undefined', () => {
    expect(isGrayColorSpaceName('/DeviceRGB')).toBe(false);
    expect(isGrayColorSpaceName('/DeviceCMYK')).toBe(false);
    expect(isGrayColorSpaceName(undefined)).toBe(false);
    // Missing the leading slash is not a valid PDF name — must not false-positive.
    expect(isGrayColorSpaceName('DeviceGray')).toBe(false);
  });
});
