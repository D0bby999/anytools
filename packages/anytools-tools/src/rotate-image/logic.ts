/**
 * Rotate/flip images entirely in the browser. Deliberately does NOT reuse `drawToBlob` from
 * ../shared/canvas-image: that helper draws a bitmap straight onto a same-size canvas with no
 * room for a rotation transform. Everything else — `loadBitmap`'s EXIF-orientation decode, the
 * 16.7 MP canvas ceiling, the JPEG-on-transparent-background fix — is reused as-is; only the
 * rotation/flip composition below is new.
 */
import { ImageToolError, type OutputFormat, decodedFrom, loadBitmap } from '../shared/canvas-image';
import { ToolError } from '../shared/tool-error';

/** Clockwise degrees to rotate. */
export type RotateAngle = 0 | 90 | 180 | 270;
export type FormatChoice = 'original' | OutputFormat;

export type RotateOptions = {
  rotate: RotateAngle;
  flipHorizontal: boolean;
  flipVertical: boolean;
  format: FormatChoice;
  /** 0–1, ignored for PNG. */
  quality: number;
};

export type RotateResult = {
  /** Position in the batch's `files` array — pairs a result to its original file for a preview. */
  sourceIndex: number;
  sourceName: string;
  name: string;
  blob: Blob;
  format: OutputFormat;
  width: number;
  height: number;
  /** Pixel size of the ORIGINAL photo, before this rotation's own width/height swap — legitimately
   * different from width/height whenever the rotation is 90 or 270, independent of scaling. */
  widthBefore: number;
  heightBefore: number;
  /** True only when the canvas ceiling forced a smaller decode than the photo's real size — NOT
   * true just because a 90/270 rotation swapped width and height. See `decodedFrom`. */
  scaledDown: boolean;
  sizeBefore: number;
  sizeAfter: number;
};

export type RotateFailure = {
  name: string;
  message: string;
  code: string;
  params: Record<string, string | number>;
};

/** `image/jpeg` → `jpeg`; anything this canvas cannot re-encode losslessly falls back to PNG. */
export function formatFromMime(mime: string): OutputFormat {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpeg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

export function resolveFormat(choice: FormatChoice, sourceMime: string): OutputFormat {
  return choice === 'original' ? formatFromMime(sourceMime) : choice;
}

/** Canvas size after a rotation — 90 and 270 swap the two axes. */
export function outputDimensions(
  width: number,
  height: number,
  rotate: RotateAngle,
): { width: number; height: number } {
  return rotate === 90 || rotate === 270 ? { width: height, height: width } : { width, height };
}

export function outputName(sourceName: string, format: OutputFormat): string {
  const base = sourceName.replace(/\.[^.]+$/, '') || 'image';
  return `${base}-rotated.${format === 'jpeg' ? 'jpg' : format}`;
}

/**
 * Make `name` unique against the names already used in this batch (case-insensitively — the
 * folder a zip is extracted into is case-insensitive on both macOS and Windows).
 */
export function uniqueName(name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Draw the (already EXIF-corrected) bitmap rotated/flipped onto a freshly-sized canvas.
 * Flip is applied before rotate in the transform stack (`ctx.scale` runs closest to the draw
 * call), so "flip horizontal" mirrors the photo as shot and rotation then turns that mirrored
 * frame — the widget's live CSS preview shows this exact composition before the user commits.
 */
function drawRotated(
  bitmap: ImageBitmap,
  opts: RotateOptions,
  format: OutputFormat,
): Promise<Blob> {
  const { width, height } = outputDimensions(bitmap.width, bitmap.height, opts.rotate);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new ImageToolError(
      'noCanvasContext',
      'Your browser did not provide a 2D canvas context.',
    );
  }
  ctx.imageSmoothingQuality = 'high';
  // JPEG has no alpha channel; an unfilled canvas encodes transparent pixels as black.
  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.translate(width / 2, height / 2);
  ctx.rotate((opts.rotate * Math.PI) / 180);
  ctx.scale(opts.flipHorizontal ? -1 : 1, opts.flipVertical ? -1 : 1);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2, bitmap.width, bitmap.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) return resolve(blob);
        const label = format.toUpperCase();
        reject(
          new ImageToolError('encodeFailed', `Your browser could not encode ${label}.`, {
            format: label,
          }),
        );
      },
      `image/${format}`,
      opts.quality,
    );
  });
}

export async function rotateImage(file: File, opts: RotateOptions): Promise<RotateResult> {
  const bitmap = await loadBitmap(file);
  try {
    const source = decodedFrom(bitmap);
    const format = resolveFormat(opts.format, file.type);
    const blob = await drawRotated(bitmap, opts, format);
    const { width, height } = outputDimensions(bitmap.width, bitmap.height, opts.rotate);
    return {
      sourceIndex: 0, // overwritten by rotateImages with the file's batch position
      sourceName: file.name,
      name: outputName(file.name, format),
      blob,
      format,
      width,
      height,
      widthBefore: source?.width ?? bitmap.width,
      heightBefore: source?.height ?? bitmap.height,
      scaledDown: source !== null,
      sizeBefore: file.size,
      sizeAfter: blob.size,
    };
  } finally {
    bitmap.close();
  }
}

/** Process a batch, keeping going past a file that fails. */
export async function rotateImages(
  files: File[],
  opts: RotateOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<{ results: RotateResult[]; failures: RotateFailure[] }> {
  const results: RotateResult[] = [];
  const failures: RotateFailure[] = [];
  const taken = new Set<string>();
  for (const [index, file] of files.entries()) {
    try {
      const r = await rotateImage(file, opts);
      results.push({ ...r, sourceIndex: index, name: uniqueName(r.name, taken) });
    } catch (e) {
      failures.push({
        name: file.name,
        message: e instanceof Error ? e.message : String(e),
        code: e instanceof ToolError ? e.code : 'unknown',
        params: e instanceof ToolError ? e.params : {},
      });
    }
    onProgress?.(index + 1, files.length);
  }
  return { results, failures };
}

/** Bundle a finished batch. Names were made unique when the batch was built. */
export async function zipRotated(results: RotateResult[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const r of results) zip.file(r.name, await r.blob.arrayBuffer());
  return zip.generateAsync({ type: 'blob' });
}
