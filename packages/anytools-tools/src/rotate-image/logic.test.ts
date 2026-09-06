// Geometry and naming only. The encode/draw path needs a real canvas, which happy-dom does not
// provide — see shared/canvas-image.test.ts. That half (EXIF orientation applied correctly,
// JPEG output getting a white background instead of black, PNG transparency preserved) is
// verified by hand in the browser lane — see docs/tool-runtime-verification.md.
import { describe, expect, it } from 'vitest';
import {
  formatFromMime,
  outputDimensions,
  outputName,
  resolveFormat,
  rotateImage,
  uniqueName,
} from './logic';

describe('rotateImage', () => {
  it('rejects a file that is not an image with a code the widget can localize', async () => {
    // happy-dom has no createImageBitmap, which lands on the same "not an image" path a
    // corrupt file does in a browser — the one decode failure reachable here.
    const file = new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' });
    await expect(
      rotateImage(file, {
        rotate: 90,
        flipHorizontal: false,
        flipVertical: false,
        format: 'original',
        quality: 0.92,
      }),
    ).rejects.toMatchObject({ code: 'imageUnreadable', params: { name: 'notes.txt' } });
  });
});

describe('formatFromMime', () => {
  it('maps known photo MIME types', () => {
    expect(formatFromMime('image/jpeg')).toBe('jpeg');
    expect(formatFromMime('image/jpg')).toBe('jpeg');
    expect(formatFromMime('image/webp')).toBe('webp');
  });

  it('falls back to PNG for anything else — lossless, keeps transparency', () => {
    expect(formatFromMime('image/gif')).toBe('png');
    expect(formatFromMime('image/bmp')).toBe('png');
    expect(formatFromMime('')).toBe('png');
  });
});

describe('resolveFormat', () => {
  it('keeps the source format when the choice is "original"', () => {
    expect(resolveFormat('original', 'image/jpeg')).toBe('jpeg');
    expect(resolveFormat('original', 'image/png')).toBe('png');
  });

  it('overrides the source format when a concrete choice is given', () => {
    expect(resolveFormat('webp', 'image/jpeg')).toBe('webp');
  });
});

describe('outputDimensions', () => {
  it('leaves width/height alone at 0° and 180°', () => {
    expect(outputDimensions(4000, 3000, 0)).toEqual({ width: 4000, height: 3000 });
    expect(outputDimensions(4000, 3000, 180)).toEqual({ width: 4000, height: 3000 });
  });

  it('swaps width and height at 90° and 270° — a landscape photo becomes portrait', () => {
    expect(outputDimensions(4000, 3000, 90)).toEqual({ width: 3000, height: 4000 });
    expect(outputDimensions(4000, 3000, 270)).toEqual({ width: 3000, height: 4000 });
  });
});

describe('outputName', () => {
  it('inserts "-rotated" before the extension', () => {
    expect(outputName('IMG_0001.JPG', 'jpeg')).toBe('IMG_0001-rotated.jpg');
    expect(outputName('logo.png', 'png')).toBe('logo-rotated.png');
  });

  it('falls back to "image" for a name with no usable base', () => {
    expect(outputName('', 'png')).toBe('image-rotated.png');
  });
});

describe('uniqueName', () => {
  it('leaves the first occurrence alone', () => {
    const taken = new Set<string>();
    expect(uniqueName('photo-rotated.jpg', taken)).toBe('photo-rotated.jpg');
  });

  it('numbers a repeat, case-insensitively — a zip extracts onto a case-insensitive folder', () => {
    const taken = new Set<string>(['photo-rotated.jpg']);
    expect(uniqueName('PHOTO-ROTATED.jpg', taken)).toBe('PHOTO-ROTATED (2).jpg');
  });

  it('keeps numbering past a second collision', () => {
    const taken = new Set<string>(['a.png', 'a (2).png']);
    expect(uniqueName('a.png', taken)).toBe('a (3).png');
  });
});
