// @vitest-environment node
/**
 * The cutout arithmetic, tested against the real functions the tool ships.
 *
 * What is NOT here: anything touching a canvas, an ImageBitmap or the WASM session. happy-dom
 * returns null from getContext and never calls back from toBlob, so a test of those would assert
 * the mock, not the tool. Those paths are covered by the browser lane in
 * docs/tool-runtime-verification.md, whose results are recorded in the phase file.
 */
import { describe, expect, it } from 'vitest';
import { MODEL_URL } from './logic';
import {
  MEAN,
  MODEL_SIZE,
  STD,
  alphaStats,
  applyThresholdInPlace,
  composeAlpha,
  maskToRgba,
  minMaxNormalise,
  normaliseToTensor,
} from './mask-math';

const rgba = (...pixels: [number, number, number, number][]) =>
  new Uint8ClampedArray(pixels.flat());

describe('normaliseToTensor', () => {
  it('lays the tensor out channel-planar, not interleaved', () => {
    const out = normaliseToTensor(
      rgba([255, 0, 0, 255], [0, 128, 0, 255], [0, 0, 64, 255], [10, 20, 30, 255]),
    );
    expect(out).toHaveLength(12);
    // Plane 0 is every red, plane 1 every green, plane 2 every blue.
    expect(out[0]).toBeCloseTo((1 - MEAN[0]) / STD[0], 5);
    expect(out[1]).toBeCloseTo((0 - MEAN[0]) / STD[0], 5);
    expect(out[4 + 1]).toBeCloseTo((128 / 255 - MEAN[1]) / STD[1], 5);
    expect(out[8 + 2]).toBeCloseTo((64 / 255 - MEAN[2]) / STD[2], 5);
    expect(out[11]).toBeCloseTo((30 / 255 - MEAN[2]) / STD[2], 5);
  });

  it('divides by the image maximum, not by 255 (rembg does this and it changes dark photos)', () => {
    const dark = rgba([10, 10, 10, 255], [4, 2, 0, 255]);
    const out = normaliseToTensor(dark);
    // 10 is the maximum, so the brightest channel normalises to 1.0 — not to 10/255.
    expect(out[0]).toBeCloseTo((1 - MEAN[0]) / STD[0], 5);
    expect(out[1]).toBeCloseTo((0.4 - MEAN[0]) / STD[0], 5);
  });

  it('produces finite values for an all-black image (the 1e-6 divisor floor)', () => {
    const out = normaliseToTensor(rgba([0, 0, 0, 255], [0, 0, 0, 255]));
    expect([...out].every(Number.isFinite)).toBe(true);
    expect(out[0]).toBeCloseTo(-MEAN[0] / STD[0], 5);
  });

  it('ignores alpha when finding the maximum', () => {
    // Alpha 255 must not become the divisor for a dark, fully opaque pixel.
    const out = normaliseToTensor(rgba([50, 0, 0, 255]));
    expect(out[0]).toBeCloseTo((1 - MEAN[0]) / STD[0], 5);
  });

  it('rejects data that is not RGBA', () => {
    expect(() => normaliseToTensor(new Uint8ClampedArray([1, 2, 3]))).toThrow(/RGBA/);
  });
});

describe('minMaxNormalise', () => {
  it('stretches the model output to 0…1', () => {
    // Values chosen to be exact in binary floating point, so this asserts the arithmetic
    // rather than the rounding.
    expect([...minMaxNormalise(new Float32Array([0.25, 0.5, 0.75]))]).toEqual([0, 0.5, 1]);
  });

  it('returns an empty mask rather than NaN when the output is flat', () => {
    expect([...minMaxNormalise(new Float32Array([0.3, 0.3, 0.3]))]).toEqual([0, 0, 0]);
  });
});

describe('maskToRgba', () => {
  it('writes the mask as opaque greyscale', () => {
    const out = maskToRgba(new Float32Array([0, 0.5, 1]));
    expect([...out.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    expect([...out.slice(4, 8)]).toEqual([128, 128, 128, 255]);
    expect([...out.slice(8, 12)]).toEqual([255, 255, 255, 255]);
  });

  it('clamps values outside 0…1', () => {
    const out = maskToRgba(new Float32Array([-2, 7]));
    expect(out[0]).toBe(0);
    expect(out[4]).toBe(255);
  });
});

describe('applyThresholdInPlace', () => {
  it('leaves the soft mask alone at 0', () => {
    const mask = maskToRgba(new Float32Array([0.2, 0.9]));
    applyThresholdInPlace(mask, 0);
    // 229, not 230: 0.9 is 0.899999976 as a float32, and the mask arrives as float32 from the
    // model. Asserting the model's real arithmetic, not the decimal literal's.
    expect(mask[0]).toBe(51);
    expect(mask[4]).toBe(229);
  });

  it('makes the mask binary at a cut-off', () => {
    const mask = maskToRgba(new Float32Array([0.2, 0.5, 0.9]));
    applyThresholdInPlace(mask, 0.5);
    expect([mask[0], mask[4], mask[8]]).toEqual([0, 255, 255]);
    // Colour channels move together — the alpha compose reads the red channel.
    expect([mask[9], mask[10], mask[11]]).toEqual([255, 255, 255]);
  });
});

describe('composeAlpha', () => {
  it('multiplies the existing alpha by the mask', () => {
    const pixels = rgba([10, 20, 30, 255], [40, 50, 60, 128]);
    const mask = maskToRgba(new Float32Array([1, 1]));
    composeAlpha(pixels, mask);
    // A source pixel that was already half transparent stays half transparent.
    expect([pixels[3], pixels[7]]).toEqual([255, 128]);
  });

  it('zeroes alpha where the mask is empty and keeps the colour untouched', () => {
    const pixels = rgba([10, 20, 30, 255]);
    composeAlpha(pixels, maskToRgba(new Float32Array([0])));
    expect([...pixels]).toEqual([10, 20, 30, 0]);
  });

  it('refuses a mask of a different size', () => {
    expect(() => composeAlpha(rgba([0, 0, 0, 255]), new Uint8ClampedArray(8))).toThrow(
      /same pixel count/,
    );
  });
});

describe('alphaStats', () => {
  it('reports the opaque and transparent shares', () => {
    const pixels = rgba([0, 0, 0, 255], [0, 0, 0, 0], [0, 0, 0, 120], [0, 0, 0, 255]);
    expect(alphaStats(pixels)).toEqual({ opaque: 0.5, transparent: 0.25 });
  });

  it('handles empty input', () => {
    expect(alphaStats(new Uint8ClampedArray(0))).toEqual({ opaque: 0, transparent: 0 });
  });
});

describe('model wiring', () => {
  it('loads the model from our own origin', () => {
    expect(MODEL_URL.startsWith('/third-party/')).toBe(true);
  });

  it('uses the input size the graph was exported with', () => {
    expect(MODEL_SIZE).toBe(320);
  });
});
