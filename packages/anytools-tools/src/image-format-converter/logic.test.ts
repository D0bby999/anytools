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
  });
});

// Note: full encode/decode tests run in browser (Playwright) — happy-dom does not
// implement canvas.toBlob or HTMLImageElement decoding reliably.
