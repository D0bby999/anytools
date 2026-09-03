// Tests the REAL toRgba, imported from ./logic. An earlier version of this file re-declared a
// private copy and asserted against that, so it stayed green no matter what the module did —
// including through a defect that made the tool return zero images on every input. A test that
// cannot fail is worse than no test, because it stops the next person looking.
//
// The end-to-end path still needs a pdf.js worker and a real canvas; happy-dom has neither.
// Extraction against real PDFs is verified in a headless browser against the production build —
// see docs/tool-runtime-verification.md. Last run 2026-09-03: fixtures/images-shared.pdf (one PNG
// drawn on three pages) → 1 image after content de-duplication, console clean, no third-party
// requests. CMYK handling and transparency remain hand-verified.
import { describe, expect, it } from 'vitest';
import { contentKey, toRgba } from './logic';

describe('contentKey', () => {
  const blob = (bytes: number[]) => new Blob([new Uint8Array(bytes)]);

  it('is identical for the same bytes under different pdf.js object names', async () => {
    // img_p0_1 on page 1 and g_d0_img_p1_1 on page 2 are the same XObject; only the key below
    // lets the extractor notice, because the names differ.
    expect(await contentKey(blob([1, 2, 3, 4]))).toBe(await contentKey(blob([1, 2, 3, 4])));
  });
  it('separates images of identical length whose bytes differ', async () => {
    // The failure mode of the length-based key this replaced: same size, same byte count,
    // different picture.
    expect(await contentKey(blob([1, 2, 3, 4]))).not.toBe(await contentKey(blob([1, 2, 3, 5])));
  });
  it('is a 64-character hex SHA-256', async () => {
    expect(await contentKey(blob([]))).toMatch(/^[0-9a-f]{64}$/);
  });
});

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
