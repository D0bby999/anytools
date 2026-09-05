/**
 * Canvas helpers shared by the image tools. No dependencies — the browser already does this.
 *
 * Deliberately NOT used by image-format-converter, which decodes via FileReader → data URL →
 * new Image(). HTMLImageElement applies EXIF orientation by default and createImageBitmap does
 * not unless told to, so swapping that tool onto this path would change its output for every
 * portrait phone photo. Its entire test suite asserts one size constant, so nothing would have
 * caught it. Leave the working tool alone.
 */

import { ToolError } from './tool-error';

export type OutputFormat = 'jpeg' | 'png' | 'webp';

/**
 * Safari caps canvas area around 16.7 megapixels — lower than Chrome, and exceeding it yields
 * a blank canvas rather than an error. Check against the strictest browser so the failure is a
 * message instead of a silently white image.
 */
export const MAX_CANVAS_PIXELS = 16_777_216;

export class ImageToolError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'ImageToolError';
  }
}

/**
 * The width to decode at so that an image lands under the canvas ceiling, or null when it
 * already fits. Pure, so the arithmetic is unit-tested without a browser.
 */
export function ceilingWidth(width: number, height: number): number | null {
  const pixels = width * height;
  if (pixels <= MAX_CANVAS_PIXELS) return null;
  // Floor, then one more pixel off if rounding of the height would still tip over the ceiling.
  let target = Math.floor(width * Math.sqrt(MAX_CANVAS_PIXELS / pixels));
  while (target > 1 && target * Math.round((height * target) / width) > MAX_CANVAS_PIXELS) target--;
  return target;
}

/** Original pixel size of a bitmap that `loadBitmap` had to decode smaller. */
const decodedFromSize = new WeakMap<ImageBitmap, { width: number; height: number }>();

/**
 * Size the file was before `loadBitmap` scaled it to fit the canvas ceiling, or null when it
 * was decoded at full size. Tools report this so "before" is the photo, not the decode.
 */
export function decodedFrom(bitmap: ImageBitmap): { width: number; height: number } | null {
  return decodedFromSize.get(bitmap) ?? null;
}

/**
 * Decode a file to a bitmap with EXIF orientation applied.
 *
 * `imageOrientation: 'from-image'` is not optional. Without it, photos taken on a phone — which
 * store the sensor's raw landscape frame plus an orientation flag — come out sideways. This is
 * the single most common defect in browser image tools.
 *
 * The retry is for browsers, some Safari versions among them, that reject the enum value rather
 * than ignoring an option they do not implement. Without it those browsers are told their
 * perfectly good JPEG "could not be read as an image", which sends the user looking at the
 * file. Second attempt drops the options entirely, so orientation is then whatever the browser
 * does by default — a sideways photo beats no photo and a false accusation.
 *
 * Above the canvas ceiling the file is decoded AGAIN at a reduced width rather than refused.
 * Refusing — what this did until 2026-09-05 — turned away every 24 MP iPhone photo (5712×4284)
 * with "resize it in an image editor first", on the tools whose job is resizing it. The decoder
 * scales during decode, so the full-size pixels never touch a canvas; `decodedFrom` reports the
 * original size so the caller can say what happened.
 */
export async function loadBitmap(file: File): Promise<ImageBitmap> {
  const decode = (options?: ImageBitmapOptions) =>
    createImageBitmap(file, { imageOrientation: 'from-image', ...options }).catch(() =>
      createImageBitmap(file, options),
    );

  let bitmap: ImageBitmap;
  try {
    bitmap = await decode();
  } catch {
    throw new ImageToolError(
      'imageUnreadable',
      `"${file.name}" could not be read as an image. Check that the file is a PNG, JPEG, WebP, GIF or AVIF.`,
      { name: file.name },
    );
  }

  const resizeWidth = ceilingWidth(bitmap.width, bitmap.height);
  if (resizeWidth === null) return bitmap;

  // Read the dimensions BEFORE closing: a detached ImageBitmap reports 0×0.
  const source = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  let reduced: ImageBitmap;
  try {
    reduced = await decode({ resizeWidth, resizeQuality: 'high' });
  } catch {
    const mp = ((source.width * source.height) / 1_000_000).toFixed(1);
    throw new ImageToolError(
      'imageTooLarge',
      `This image is ${source.width}×${source.height} (${mp} megapixels), above what this browser can decode onto a canvas. Resize it in an image editor first.`,
      { width: source.width, height: source.height, mp },
    );
  }
  decodedFromSize.set(reduced, source);
  return reduced;
}

/** Draw a bitmap at a target size and encode. Callers must close the bitmap. */
export async function drawToBlob(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  format: OutputFormat,
  quality: number,
  source?: { x: number; y: number; width: number; height: number },
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new ImageToolError(
      'noCanvasContext',
      'Your browser did not provide a 2D canvas context.',
    );
  }
  // The default is 'low': a 4000px photo drawn straight to 800px comes out aliased, which reads
  // as "this tool makes my pictures worse". 'high' is a proper multi-tap filter where supported.
  ctx.imageSmoothingQuality = 'high';

  // JPEG has no alpha channel. Left alone, the canvas's transparent pixels encode as black,
  // so a logo on a transparent PNG came back on a black slab. White is what every image
  // editor does for the same export.
  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (source) {
    ctx.drawImage(
      bitmap,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  } else {
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, `image/${format}`, quality),
  );
  if (!blob) {
    const label = format.toUpperCase();
    throw new ImageToolError('encodeFailed', `Your browser could not encode ${label}.`, {
      format: label,
    });
  }
  return blob;
}

/**
 * Does this image use its alpha channel?
 *
 * Matters because JPEG has no alpha: a transparent background silently becomes black (or white,
 * depending on the browser) with no warning from the encoder. Sampling rather than scanning
 * every pixel — a 4000×3000 image is 48 MB of pixel data, and a stride of 4 finds any real
 * transparent region while staying fast.
 */
export function hasAlpha(bitmap: ImageBitmap): boolean {
  const canvas = document.createElement('canvas');
  // Downsample first: transparency is a property of regions, not individual pixels, and a
  // 512px thumbnail preserves any region big enough to matter.
  const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 3; i < data.length; i += 4) {
    if ((data[i] ?? 255) < 250) return true;
  }
  return false;
}

/** Fit (w, h) inside a box, preserving aspect ratio. Never enlarges. */
export function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}
