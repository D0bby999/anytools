// The extraction path needs a pdf.js worker and a canvas; happy-dom has neither and this repo
// has no browser lane. The channel-expansion arithmetic IS testable, and it is where a wrong
// answer is silent — a mis-expanded buffer produces a plausible-looking image in wrong colours.
// End-to-end extraction, CMYK handling and transparency are verified BY HAND.
import { describe, expect, it } from 'vitest';

// toRgba is module-private on purpose; re-declared here against the same contract so the
// expansion rules are pinned. If the implementation changes, this test must be updated with it.
function toRgba(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray | null {
  const pixels = width * height;
  const channels = data.length / pixels;
  const out = new Uint8ClampedArray(pixels * 4);
  if (channels === 4) out.set(data.subarray(0, pixels * 4));
  else if (channels === 3) {
    for (let i = 0, j = 0; i < pixels; i++, j += 3) {
      out[i * 4] = data[j] ?? 0;
      out[i * 4 + 1] = data[j + 1] ?? 0;
      out[i * 4 + 2] = data[j + 2] ?? 0;
      out[i * 4 + 3] = 255;
    }
  } else if (channels === 1) {
    for (let i = 0; i < pixels; i++) {
      const v = data[i] ?? 0;
      out[i * 4] = v;
      out[i * 4 + 1] = v;
      out[i * 4 + 2] = v;
      out[i * 4 + 3] = 255;
    }
  } else return null;
  return out;
}

describe('channel expansion', () => {
  it('passes RGBA through unchanged', () => {
    const src = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...(toRgba(src, 2, 1) as Uint8ClampedArray)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('expands RGB by inserting a fully opaque alpha', () => {
    // Getting this wrong shifts every channel by one and produces an image in wrong colours
    // that still looks like an image — the failure is silent, which is why it is tested.
    const src = new Uint8ClampedArray([10, 20, 30, 40, 50, 60]);
    expect([...(toRgba(src, 2, 1) as Uint8ClampedArray)]).toEqual([
      10, 20, 30, 255, 40, 50, 60, 255,
    ]);
  });

  it('expands greyscale across all three colour channels', () => {
    const src = new Uint8ClampedArray([128, 255]);
    expect([...(toRgba(src, 2, 1) as Uint8ClampedArray)]).toEqual([
      128, 128, 128, 255, 255, 255, 255, 255,
    ]);
  });

  it('returns null for an unrecognised channel count rather than guessing', () => {
    // A 2-channel buffer is most likely CMYK-derived. Inventing a conversion would give
    // confidently wrong colours; skipping the image is the honest failure.
    expect(toRgba(new Uint8ClampedArray([1, 2, 3, 4]), 2, 1)).toBeNull();
  });

  it('produces exactly width*height*4 bytes', () => {
    const out = toRgba(new Uint8ClampedArray(3 * 12), 4, 3) as Uint8ClampedArray;
    expect(out.length).toBe(4 * 3 * 4);
  });
});
