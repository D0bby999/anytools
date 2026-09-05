import {
  type OutputFormat,
  decodedFrom,
  drawToBlob,
  hasAlpha,
  loadBitmap,
} from '../shared/canvas-image';

export type CompressResult = {
  blob: Blob;
  width: number;
  height: number;
  sizeBefore: number;
  sizeAfter: number;
  format: OutputFormat;
  /** True when the source used transparency — JPEG would lose it. */
  sourceHasAlpha: boolean;
  /** Set when the source was above the canvas ceiling and was decoded smaller first. */
  scaledFrom: { width: number; height: number } | null;
  /**
   * Set only by compressToTargetSize. `false` means the budget could not be met even at the
   * lowest quality — the caller MUST say so rather than reporting the saving against the
   * original, which reads as success for a result that missed by a mile.
   */
  targetMet?: boolean;
};

/** Quality search bounds. 1 is included so an image that already fits is not re-encoded lossily. */
const MIN_QUALITY = 0.1;
const MAX_QUALITY = 1;

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
      scaledFrom: decodedFrom(bitmap),
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

    // Try full quality first. Without this the search interval is open at the top — the first
    // midpoint is 0.55 — so an image that already fits at quality 1 gets re-encoded lossily
    // for no reason at all.
    const full = await drawToBlob(bitmap, bitmap.width, bitmap.height, format, MAX_QUALITY);
    if (full.size <= targetBytes) {
      return {
        blob: full,
        width: bitmap.width,
        height: bitmap.height,
        sizeBefore: file.size,
        sizeAfter: full.size,
        format,
        sourceHasAlpha: alpha,
        scaledFrom: decodedFrom(bitmap),
        targetMet: true,
      };
    }

    let lo = MIN_QUALITY;
    let hi = MAX_QUALITY;
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

    // Nothing fit even at the lowest quality. Return that attempt rather than throwing — "as
    // small as this format goes" is more useful than an error — but flag it, because reporting
    // the saving against the original would read as success for a result that missed the
    // budget entirely.
    const fallback =
      best ?? (await drawToBlob(bitmap, bitmap.width, bitmap.height, format, MIN_QUALITY));

    return {
      blob: fallback,
      width: bitmap.width,
      height: bitmap.height,
      sizeBefore: file.size,
      sizeAfter: fallback.size,
      format,
      sourceHasAlpha: alpha,
      scaledFrom: decodedFrom(bitmap),
      targetMet: fallback.size <= targetBytes,
    };
  } finally {
    bitmap.close();
  }
}
