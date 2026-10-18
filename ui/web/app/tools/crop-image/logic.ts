import { type OutputFormat, decodedFrom, drawToBlob, loadBitmap } from '../shared/canvas-image';

/** Crop rectangle in FRACTIONS of the source (0-1), so it survives preview scaling. */
export type CropRect = { x: number; y: number; width: number; height: number };

export type AspectPreset = { label: string; ratio: number | null };

export const ASPECT_PRESETS: AspectPreset[] = [
  { label: 'Free', ratio: null },
  { label: '1:1 square', ratio: 1 },
  { label: '4:5 portrait', ratio: 4 / 5 },
  { label: '3:2 landscape', ratio: 3 / 2 },
  { label: '16:9 widescreen', ratio: 16 / 9 },
];

export type CropResult = {
  blob: Blob;
  width: number;
  height: number;
  sizeBefore: number;
  sizeAfter: number;
  /** Set when the source was above the canvas ceiling: the crop was cut from a smaller decode. */
  scaledFrom: { width: number; height: number } | null;
};

/**
 * Clamp a rectangle into the unit square, keeping it non-empty.
 *
 * The UI works in fractions rather than pixels so that a rectangle drawn on a 600px-wide
 * preview maps exactly onto a 6000px original. Doing it in preview pixels and scaling up at
 * the end is where off-by-a-few-pixels crops come from.
 */
export function clampRect(rect: CropRect): CropRect {
  const x = Math.min(Math.max(rect.x, 0), 1);
  const y = Math.min(Math.max(rect.y, 0), 1);
  const width = Math.min(Math.max(rect.width, 0.001), 1 - x);
  const height = Math.min(Math.max(rect.height, 0.001), 1 - y);
  return { x, y, width, height };
}

/** Shrink a rectangle to a fixed aspect ratio, anchored at its top-left. */
export function applyAspect(rect: CropRect, ratio: number, srcW: number, srcH: number): CropRect {
  // Ratios are width:height in PIXELS, but the rect is in fractions of a possibly
  // non-square image — so convert through the source dimensions rather than comparing
  // fractions directly.
  const pxW = rect.width * srcW;
  const pxH = rect.height * srcH;
  const currentRatio = pxW / pxH;
  const next =
    currentRatio > ratio
      ? { w: pxH * ratio, h: pxH } // too wide: pull the width in
      : { w: pxW, h: pxW / ratio }; // too tall: pull the height in
  return clampRect({ ...rect, width: next.w / srcW, height: next.h / srcH });
}

export async function cropImage(
  file: File,
  rect: CropRect,
  format: OutputFormat,
  quality = 0.92,
): Promise<CropResult> {
  const bitmap = await loadBitmap(file);
  try {
    const r = clampRect(rect);
    const source = {
      x: Math.round(r.x * bitmap.width),
      y: Math.round(r.y * bitmap.height),
      width: Math.max(1, Math.round(r.width * bitmap.width)),
      height: Math.max(1, Math.round(r.height * bitmap.height)),
    };
    const blob = await drawToBlob(bitmap, source.width, source.height, format, quality, source);
    return {
      blob,
      width: source.width,
      height: source.height,
      sizeBefore: file.size,
      sizeAfter: blob.size,
      scaledFrom: decodedFrom(bitmap),
    };
  } finally {
    bitmap.close();
  }
}
