// Placement math and naming only — everything importable and testable without a canvas. The
// drawing half (render.ts: text/logo actually painted, opacity, rotation, tiling, JPEG-on-alpha)
// needs a real `<canvas>`, which happy-dom does not provide — see shared/canvas-image.test.ts.
// Verified by hand in the browser lane instead; see docs/tool-runtime-verification.md.
//
// Everything below is imported from './logic', not './geometry' directly, even though the
// implementations live in geometry.ts — logic.ts re-exports them so ui.tsx and this file share
// one import path, and so this test exercises the real public API rather than an internal.
import { describe, expect, it } from 'vitest';
import {
  formatFromMime,
  imageMarkSize,
  markCenter,
  outputName,
  resolveFormat,
  textFontSizePx,
  tileCenters,
  uniqueName,
  watermarkImage,
} from './logic';

describe('watermarkImage', () => {
  it('rejects a file that is not an image with a code the widget can localize', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' });
    await expect(
      watermarkImage(file, {
        kind: 'text',
        text: 'DRAFT',
        color: '#808080',
        sizePercent: 8,
        position: { kind: 'grid', grid: 'center' },
        opacity: 0.5,
        rotation: 0,
        tile: false,
        format: 'original',
        quality: 0.92,
      }),
    ).rejects.toMatchObject({ code: 'imageUnreadable', params: { name: 'notes.txt' } });
  });

  it('rejects empty watermark text before touching the file', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
    await expect(
      watermarkImage(file, {
        kind: 'text',
        text: '   ',
        color: '#000000',
        sizePercent: 8,
        position: { kind: 'grid', grid: 'center' },
        opacity: 0.5,
        rotation: 0,
        tile: false,
        format: 'original',
        quality: 0.92,
      }),
    ).rejects.toMatchObject({ code: 'watermarkTextEmpty' });
  });

  it('rejects an opacity outside (0, 1]', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
    await expect(
      watermarkImage(file, {
        kind: 'text',
        text: 'DRAFT',
        color: '#000000',
        sizePercent: 8,
        position: { kind: 'grid', grid: 'center' },
        opacity: 0,
        rotation: 0,
        tile: false,
        format: 'original',
        quality: 0.92,
      }),
    ).rejects.toMatchObject({ code: 'opacityRange' });
  });
});

describe('formatFromMime / resolveFormat', () => {
  it('maps known photo MIME types, falling back to PNG', () => {
    expect(formatFromMime('image/jpeg')).toBe('jpeg');
    expect(formatFromMime('image/webp')).toBe('webp');
    expect(formatFromMime('image/gif')).toBe('png');
  });

  it('keeps the source format for "original", overrides otherwise', () => {
    expect(resolveFormat('original', 'image/jpeg')).toBe('jpeg');
    expect(resolveFormat('png', 'image/jpeg')).toBe('png');
  });
});

describe('outputName / uniqueName', () => {
  it('inserts "-watermarked" before the extension', () => {
    expect(outputName('photo.JPG', 'jpeg')).toBe('photo-watermarked.jpg');
  });

  it('numbers a repeat case-insensitively', () => {
    const taken = new Set<string>(['a-watermarked.png']);
    expect(uniqueName('A-WATERMARKED.png', taken)).toBe('A-WATERMARKED (2).png');
  });
});

describe('textFontSizePx', () => {
  it('scales with the image width', () => {
    expect(textFontSizePx(1000, 10)).toBe(100);
    expect(textFontSizePx(2000, 10)).toBe(200);
  });

  it('never goes below a readable floor', () => {
    expect(textFontSizePx(50, 1)).toBe(8);
  });
});

describe('imageMarkSize', () => {
  it('keeps the logo aspect ratio while scaling to a percent of the canvas width', () => {
    expect(imageMarkSize(1000, 20, 400, 200)).toEqual({ width: 200, height: 100 });
  });

  it('never yields a zero-pixel box', () => {
    expect(imageMarkSize(10, 1, 1000, 1000)).toEqual({ width: 1, height: 1 });
  });
});

describe('markCenter', () => {
  it('centers a grid position exactly at the middle', () => {
    expect(markCenter({ kind: 'grid', grid: 'center' }, 1000, 800, 100, 50)).toEqual({
      x: 500,
      y: 400,
    });
  });

  it('keeps a corner position inset by the margin plus half the mark', () => {
    const c = markCenter({ kind: 'grid', grid: 'top-left' }, 1000, 800, 100, 50);
    // margin = 4% of the shorter side (800) = 32
    expect(c).toEqual({ x: 32 + 50, y: 32 + 25 });
  });

  it('reads a custom position as a direct percentage of the canvas', () => {
    expect(markCenter({ kind: 'custom', xPercent: 25, yPercent: 75 }, 1000, 800, 0, 0)).toEqual({
      x: 250,
      y: 600,
    });
  });

  it('covers every grid cell without throwing', () => {
    const grids = [
      'top-left',
      'top-center',
      'top-right',
      'middle-left',
      'center',
      'middle-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
    ] as const;
    for (const grid of grids) {
      const c = markCenter({ kind: 'grid', grid }, 500, 500, 40, 40);
      expect(Number.isFinite(c.x)).toBe(true);
      expect(Number.isFinite(c.y)).toBe(true);
    }
  });
});

describe('tileCenters', () => {
  it('covers the whole canvas including a buffered margin past the edges', () => {
    const centers = tileCenters(50, 50, 300, 200);
    expect(centers.length).toBeGreaterThan(1);
    const xs = centers.map((c) => c.x);
    const ys = centers.map((c) => c.y);
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(300);
    expect(Math.min(...ys)).toBeLessThan(0);
    expect(Math.max(...ys)).toBeGreaterThan(200);
  });
});
