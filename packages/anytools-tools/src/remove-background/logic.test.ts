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
import { cacheKeyFor, isAbortError, isStaleCacheEntry, toHex } from '../shared/onnx-loader';
import { MODEL, removeBackground } from './logic';
import {
  MAX_WORK_PIXELS,
  MEAN,
  STD,
  alphaStats,
  applyThresholdInPlace,
  composeAlpha,
  maskToRgba,
  minMaxNormalise,
  normaliseToTensor,
  workSize,
} from './mask-math';

const rgba = (...pixels: [number, number, number, number][]) =>
  new Uint8ClampedArray(pixels.flat());

describe('removeBackground', () => {
  it('rejects a file that is not an image with a code the widget can localize', async () => {
    // node has no createImageBitmap, which lands on the same "not an image" path a corrupt file
    // does in a browser — the one failure reachable before the engine is needed.
    const file = new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' });
    await expect(
      removeBackground(file, { threshold: 0.5, feather: 1, background: null }),
    ).rejects.toMatchObject({ code: 'imageUnreadable', params: { name: 'notes.txt' } });
  });
});

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

describe('workSize', () => {
  it('leaves an image at or below the ceiling alone', () => {
    expect(workSize(2000, 1500)).toEqual({ width: 2000, height: 1500, scaled: false });
  });

  it('scales a larger image down to the ceiling, keeping the aspect ratio', () => {
    const out = workSize(6000, 4000); // 24 Mpx
    expect(out.scaled).toBe(true);
    expect(out.width * out.height).toBeLessThanOrEqual(MAX_WORK_PIXELS * 1.001);
    expect(out.width / out.height).toBeCloseTo(6000 / 4000, 3);
  });

  it('never returns a zero dimension for an extreme panorama', () => {
    const out = workSize(60_000, 20);
    expect(out.height).toBeGreaterThanOrEqual(1);
    expect(out.width).toBeGreaterThanOrEqual(1);
  });
});

/**
 * The cache-key helpers live in shared/onnx-loader.ts but are exercised here: this tool is the
 * only caller, and the loader has no test file of its own to add to.
 */
describe('model cache keys', () => {
  it('pins the weights to their sha256, so new weights cannot reuse an old entry', () => {
    const key = cacheKeyFor(MODEL.url, MODEL.sha256);
    expect(key).toBe(`${MODEL.url}?v=${MODEL.sha256}`);
    expect(cacheKeyFor(MODEL.url, 'other-hash')).not.toBe(key);
  });

  it('treats a pre-versioning entry for the same path as stale', () => {
    expect(isStaleCacheEntry('http://x/third-party/u2netp/u2netp.onnx', MODEL.url, 'a')).toBe(true);
  });

  it('treats an entry from another version as stale, and the current one as fresh', () => {
    const url = '/third-party/onnx/ort-wasm-simd-threaded.wasm';
    expect(isStaleCacheEntry(`http://x${url}?v=1.28.0`, url, '1.29.0')).toBe(true);
    expect(isStaleCacheEntry(`http://x${url}?v=1.29.0`, url, '1.29.0')).toBe(false);
  });

  it('never deletes another asset that happens to be cached alongside', () => {
    const url = '/third-party/onnx/ort-wasm-simd-threaded.wasm';
    expect(isStaleCacheEntry('http://x/third-party/u2netp/u2netp.onnx?v=z', url, '1.29.0')).toBe(
      false,
    );
  });

  it('escapes a version that would otherwise change the query string', () => {
    expect(cacheKeyFor('/a.wasm', '1.0 &b=c')).toBe('/a.wasm?v=1.0%20%26b%3Dc');
  });
});

describe('integrity check', () => {
  it('hexes a digest the way the pinned sha256 is written', async () => {
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array());
    // The SHA-256 of the empty input, lower-case hex — the form vendor-assets.json uses.
    expect(toHex(digest)).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('pins a 64-character lower-case hex digest for the weights', () => {
    expect(MODEL.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('isAbortError', () => {
  it('recognises the DOMException a cancelled fetch raises', () => {
    expect(isAbortError(new DOMException('stopped', 'AbortError'))).toBe(true);
  });

  it('does not swallow a real failure', () => {
    expect(isAbortError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
  });
});
