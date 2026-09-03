/**
 * Canvas helpers shared by the image tools. No dependencies — the browser already does this.
 *
 * Deliberately NOT used by image-format-converter, which decodes via FileReader → data URL →
 * new Image(). HTMLImageElement applies EXIF orientation by default and createImageBitmap does
 * not unless told to, so swapping that tool onto this path would change its output for every
 * portrait phone photo. Its entire test suite asserts one size constant, so nothing would have
 * caught it. Leave the working tool alone.
 */

export type OutputFormat = 'jpeg' | 'png' | 'webp';

/**
 * Safari caps canvas area around 16.7 megapixels — lower than Chrome, and exceeding it yields
 * a blank canvas rather than an error. Check against the strictest browser so the failure is a
 * message instead of a silently white image.
 */
export const MAX_CANVAS_PIXELS = 16_777_216;

export class ImageToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageToolError';
  }
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
 */
export async function loadBitmap(file: File): Promise<ImageBitmap> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new ImageToolError(
        `"${file.name}" could not be read as an image. Check that the file is a PNG, JPEG, WebP, GIF or AVIF.`,
      );
    }
  }
  if (bitmap.width * bitmap.height > MAX_CANVAS_PIXELS) {
    // Read the dimensions BEFORE closing. A detached ImageBitmap reports 0x0, so closing first
    // produced "This image is 0×0 (139.0 megapixels)" — nonsense, on the one message whose job
    // is telling the user what to fix.
    const { width, height } = bitmap;
    const mp = (width * height) / 1_000_000;
    bitmap.close();
    throw new ImageToolError(
      `This image is ${width}×${height} (${mp.toFixed(1)} megapixels), above what browsers reliably handle on a canvas. Resize it in an image editor first.`,
    );
  }
  return bitmap;
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
  if (!ctx) throw new ImageToolError('Your browser did not provide a 2D canvas context.');

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
  if (!blob) throw new ImageToolError(`Your browser could not encode ${format.toUpperCase()}.`);
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
