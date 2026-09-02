// Tests the REAL toRgba, imported from ./logic. An earlier version of this file re-declared a
// private copy and asserted against that, so it stayed green no matter what the module did —
// including through a defect that made the tool return zero images on every input. A test that
// cannot fail is worse than no test, because it stops the next person looking.
//
// The end-to-end path still needs a pdf.js worker and a real canvas; happy-dom has neither and
// this repo has no browser lane. Extraction against real PDFs, CMYK handling and transparency
// are verified BY HAND.
import { describe, expect, it } from 'vitest';
import { toRgba } from './logic';

// happy-dom does not implement ImageData; a minimal stand-in is enough for toRgba, which only
// constructs one. Installed before the assertions rather than mocked per-test.
class FakeImageData {
  constructor(
    readonly data: Uint8ClampedArray,
    readonly width: number,
    readonly height: number,
  ) {}
}
if (typeof globalThis.ImageData === 'undefined') {
  (globalThis as { ImageData?: unknown }).ImageData = FakeImageData;
}

const bytes = (d: ImageData | null) => (d ? [...d.data] : null);

describe('toRgba', () => {
  it('passes RGBA through unchanged', () => {
    expect(bytes(toRgba(new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]), 2, 1))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('expands RGB by inserting a fully opaque alpha', () => {
    // Getting this wrong shifts every channel by one: the image still looks like an image,
    // in the wrong colours. Silent, which is why it is pinned.
    expect(bytes(toRgba(new Uint8ClampedArray([10, 20, 30, 40, 50, 60]), 2, 1))).toEqual([
      10, 20, 30, 255, 40, 50, 60, 255,
    ]);
  });

  it('expands greyscale across all three colour channels', () => {
    expect(bytes(toRgba(new Uint8ClampedArray([128, 255]), 2, 1))).toEqual([
      128, 128, 128, 255, 255, 255, 255, 255,
    ]);
  });

  it('returns null for an unrecognised channel count rather than guessing', () => {
    // A 2-channel buffer is most likely CMYK-derived. Inventing a conversion gives
    // confidently wrong colours; skipping the image is the honest failure.
    expect(toRgba(new Uint8ClampedArray([1, 2, 3, 4]), 2, 1)).toBeNull();
  });

  it('produces exactly width*height*4 bytes', () => {
    expect(toRgba(new Uint8ClampedArray(3 * 12), 4, 3)?.data.length).toBe(4 * 3 * 4);
  });

  it('reports the dimensions it was given', () => {
    const out = toRgba(new Uint8ClampedArray(4 * 6), 3, 2);
    expect([out?.width, out?.height]).toEqual([3, 2]);
  });
});
