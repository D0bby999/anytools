import { type OutputFormat, drawToBlob, fitWithin, loadBitmap } from '../shared/canvas-image';

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
    const { width, height } = targetSize(mode, bitmap.width, bitmap.height);
    const blob = await drawToBlob(bitmap, width, height, format, quality);
    return {
      blob,
      widthBefore: bitmap.width,
      heightBefore: bitmap.height,
      width,
      height,
      sizeBefore: file.size,
      sizeAfter: blob.size,
    };
  } finally {
    bitmap.close();
  }
}
