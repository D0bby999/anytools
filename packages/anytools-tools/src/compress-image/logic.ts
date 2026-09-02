import { type OutputFormat, drawToBlob, hasAlpha, loadBitmap } from '../shared/canvas-image';

export type CompressResult = {
  blob: Blob;
  width: number;
  height: number;
  sizeBefore: number;
  sizeAfter: number;
  format: OutputFormat;
  /** True when the source used transparency — JPEG would lose it. */
  sourceHasAlpha: boolean;
};

export type CompressOptions = {
  format: OutputFormat;
  /** 0.1–1. Ignored for PNG, which is lossless. */
  quality: number;
};

export async function compressImage(
  file: File,
  { format, quality }: CompressOptions,
): Promise<CompressResult> {
  const bitmap = await loadBitmap(file);
  try {
    const alpha = hasAlpha(bitmap);
    const blob = await drawToBlob(bitmap, bitmap.width, bitmap.height, format, quality);
    return {
      blob,
      width: bitmap.width,
      height: bitmap.height,
      sizeBefore: file.size,
      sizeAfter: blob.size,
      format,
      sourceHasAlpha: alpha,
    };
  } finally {
    // Bitmaps hold decoded pixel data outside the JS heap; without close() a few large
    // photos in a row will exhaust the tab.
    bitmap.close();
  }
}

/**
 * Find the highest quality that fits under a byte budget, by binary search.
 *
 * Ten or so encodes, not the linear sweep a naive version does. This is the whole of what
 * `browser-image-compression` adds over the canvas API, which is why that dependency is not
 * here — it is a loop, and this is the loop.
 */
export async function compressToTargetSize(
  file: File,
  format: OutputFormat,
  targetBytes: number,
): Promise<CompressResult> {
  const bitmap = await loadBitmap(file);
  try {
    const alpha = hasAlpha(bitmap);
    let lo = 0.1;
    let hi = 1;
    let best: Blob | null = null;

    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      const blob = await drawToBlob(bitmap, bitmap.width, bitmap.height, format, mid);
      if (blob.size <= targetBytes) {
        // Fits — keep it and try for better quality.
        best = blob;
        lo = mid;
      } else {
        hi = mid;
      }
    }

    // Nothing fit even at the lowest quality. Return that attempt rather than throwing:
    // the caller can see the size and decide, and "as small as this format goes" is a more
    // useful answer than an error.
    if (!best) best = await drawToBlob(bitmap, bitmap.width, bitmap.height, format, 0.1);

    return {
      blob: best,
      width: bitmap.width,
      height: bitmap.height,
      sizeBefore: file.size,
      sizeAfter: best.size,
      format,
      sourceHasAlpha: alpha,
    };
  } finally {
    bitmap.close();
  }
}
