import { describe, expect, it } from 'vitest';
import { MAX_BYTES, convertImage } from './logic';

describe('MAX_BYTES', () => {
  it('is 10 MB', () => {
    expect(MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('convertImage size guard', () => {
  it('rejects files over MAX_BYTES', async () => {
    // Build a fake oversized Blob without allocating real bytes
    const big = new Blob(['x'], { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: MAX_BYTES + 1, configurable: true });
    await expect(convertImage(big, 'png')).rejects.toThrow(/too large/i);
    await expect(convertImage(big, 'png')).rejects.toMatchObject({
      code: 'tooLarge',
      params: { size: '10.0', max: 10 },
    });
  });
});

// COVERAGE GAP — read before trusting this file.
//
// The encode/decode path is NOT tested anywhere. happy-dom (this package's vitest
// environment) returns null from canvas.getContext('2d') and never invokes the
// toBlob callback, so a test of the real conversion hangs to timeout rather than
// failing usefully. There is no browser lane either: the repo has no Playwright
// dependency and no playwright config.
//
// This note previously read "full encode/decode tests run in browser (Playwright)",
// which described a suite that has never existed — a claim of coverage is worse than
// none, because it stops the next person looking. What is actually covered here is
// the size guard and its constant.
//
// So: quality, EXIF orientation and format correctness are verified by hand, not by
// CI. Changing this file's logic means checking a portrait phone photo, a PNG with
// transparency, and an oversized image in a real browser.
