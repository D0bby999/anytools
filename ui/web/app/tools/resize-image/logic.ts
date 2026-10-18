import {
  type OutputFormat,
  decodedFrom,
  drawToBlob,
  fitWithin,
  loadBitmap,
} from '../shared/canvas-image';

export type ResizeMode =
  /** Fit inside a box, keeping the aspect ratio. */
  | { kind: 'fit'; maxWidth: number; maxHeight: number }
  /** Scale by a percentage of the original. */
  | { kind: 'percent'; percent: number }
  /** Exact dimensions. Distorts unless the ratio happens to match. */
  | { kind: 'exact'; width: number; height: number };

export type ResizeResult = {
  blob: Blob;
  widthBefore: number;
  heightBefore: number;
  width: number;
  height: number;
  sizeBefore: number;
  sizeAfter: number;
  /** Set when the source was above the canvas ceiling and was decoded smaller before resizing. */
  scaledFrom: { width: number; height: number } | null;
};

export function targetSize(
  mode: ResizeMode,
  srcWidth: number,
  srcHeight: number,
): { width: number; height: number } {
  switch (mode.kind) {
    case 'fit':
      return fitWithin(srcWidth, srcHeight, mode.maxWidth, mode.maxHeight);
    case 'percent': {
      const f = mode.percent / 100;
      return {
        width: Math.max(1, Math.round(srcWidth * f)),
        height: Math.max(1, Math.round(srcHeight * f)),
      };
    }
    case 'exact':
      return { width: Math.max(1, mode.width), height: Math.max(1, mode.height) };
  }
}

export async function resizeImage(
  file: File,
  mode: ResizeMode,
  format: OutputFormat,
  quality = 0.9,
): Promise<ResizeResult> {
  const bitmap = await loadBitmap(file);
  try {
    const source = decodedFrom(bitmap);
    // Percent and fit are measured against the photo's real size, so "50%" of a 24 MP photo
    // is what the user meant even though the decode in hand is smaller.
    const { width, height } = targetSize(
      mode,
      source?.width ?? bitmap.width,
      source?.height ?? bitmap.height,
    );
    const blob = await drawToBlob(bitmap, width, height, format, quality);
    return {
      blob,
      widthBefore: source?.width ?? bitmap.width,
      heightBefore: source?.height ?? bitmap.height,
      width,
      height,
      sizeBefore: file.size,
      sizeAfter: blob.size,
      scaledFrom: source,
    };
  } finally {
    bitmap.close();
  }
}
