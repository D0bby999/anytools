// The pure geometry here is testable; the canvas parts are not — happy-dom returns null from
// getContext('2d') and never fires the toBlob callback, so a test of the encode path hangs to
// timeout rather than failing. There is no Playwright in this repo either. Encoding, EXIF
// orientation and alpha detection are verified BY HAND. See the note in image-format-converter.
import { describe, expect, it } from 'vitest';
import { MAX_CANVAS_PIXELS, fitWithin } from './canvas-image';

describe('fitWithin', () => {
  it('scales down to fit the narrower dimension', () => {
    expect(fitWithin(4000, 3000, 1920, 1920)).toEqual({ width: 1920, height: 1440 });
    expect(fitWithin(3000, 4000, 1920, 1920)).toEqual({ width: 1440, height: 1920 });
  });

  it('never enlarges — upscaling invents detail that is not there', () => {
    expect(fitWithin(400, 300, 1920, 1920)).toEqual({ width: 400, height: 300 });
  });

  it('handles a square box and a square image', () => {
    expect(fitWithin(1000, 1000, 500, 500)).toEqual({ width: 500, height: 500 });
  });

  it('respects the tighter of the two limits', () => {
    expect(fitWithin(1000, 1000, 800, 200)).toEqual({ width: 200, height: 200 });
  });

  it('rounds to whole pixels', () => {
    const r = fitWithin(1001, 333, 500, 500);
    expect(Number.isInteger(r.width)).toBe(true);
    expect(Number.isInteger(r.height)).toBe(true);
  });
});

describe('MAX_CANVAS_PIXELS', () => {
  it("matches Safari's limit, the strictest of the major browsers", () => {
    // Chrome allows more. Checking against the loosest would produce a blank canvas on
    // Safari rather than a message, which is the failure this constant exists to prevent.
    expect(MAX_CANVAS_PIXELS).toBe(16_777_216);
    // A 4032x3024 phone photo (12 MP) must stay under it.
    expect(4032 * 3024).toBeLessThan(MAX_CANVAS_PIXELS);
  });
});
