import { MAX_CANVAS_PIXELS, drawToBlob, fitWithin } from '../shared/canvas-image';
import { classifyBrand, readFtypBrand } from '../shared/ftyp';
import { loadLibheif } from '../shared/libheif-loader';
import { ToolError } from '../shared/tool-error';
import { HeicDecodeError, decodeHeif } from './decode';

export type HeicFormat = 'jpeg' | 'png';
export type HeicOptions = { format: HeicFormat; quality: number };

export type HeicConversion = {
  sourceName: string;
  sourceSize: number;
  name: string;
  blob: Blob;
  /** Size of the file that was written. Smaller than the decode when the canvas ceiling bit. */
  width: number;
  height: number;
  /** Size the photo was taken at. Equal to width/height unless the image had to be scaled down. */
  sourceWidth: number;
  sourceHeight: number;
  /** Top-level images in the container. A burst or a Live Photo still has more than one. */
  imageCount: number;
};

/**
 * One file that did not convert. `message` is the English sentence; `code` + `params` let the UI
 * look up a translation for it (`error_<code>`), the way `toolErrorText` does for thrown errors.
 */
export type HeicFailure = {
  name: string;
  message: string;
  code: string;
  params: Record<string, string | number>;
};

/** What the file picker accepts. `.hif` is Canon's spelling of the same container. */
export const HEIC_EXTENSIONS = ['.heic', '.heif', '.hif'] as const;

/** Cheap pre-filter for the dropzone; the bytes decide once the file is read. */
export function looksLikeHeic(file: { name: string; type: string }): boolean {
  const name = file.name.toLowerCase();
  return (
    HEIC_EXTENSIONS.some((ext) => name.endsWith(ext)) ||
    file.type === 'image/heic' ||
    file.type === 'image/heif'
  );
}

/** Reject nonsense before a 1 MB WASM download and a full decode. */
export function validateOptions(options: HeicOptions): HeicOptions {
  if (options.format !== 'jpeg' && options.format !== 'png') {
    const format = String(options.format);
    throw new HeicDecodeError('heicBadFormat', `Unsupported output format "${format}".`, {
      format,
    });
  }
  if (!Number.isFinite(options.quality) || options.quality <= 0 || options.quality > 1) {
    throw new HeicDecodeError(
      'heicBadQuality',
      'JPEG quality must be greater than 0 and at most 1.',
    );
  }
  return options;
}

/** `photo.HEIC` → `photo.jpg`. Any other extension keeps its name and gains the new one. */
export function outputName(sourceName: string, format: HeicFormat): string {
  const base = sourceName.replace(/\.(heic|heif|hif)$/i, '') || 'image';
  return `${base}.${format === 'jpeg' ? 'jpg' : 'png'}`;
}

/**
 * Make `name` unique against the names already used in this batch.
 *
 * Two photos called IMG_0001.HEIC from two folders both want IMG_0001.jpg, and a zip written
 * from that gives the user one file for two inputs — silently. Compared case-insensitively
 * because the folder the zip is extracted into is case-insensitive on Windows and macOS.
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
 * The size to write, scaled down if the decoded image is beyond what a canvas will draw.
 *
 * Refusing instead — what this did until 2026-09-03 — turns away the default 24 MP iPhone photo
 * (5712 × 4284), which is the single most likely file to arrive here. Safari's ~16.7 MP canvas
 * ceiling yields a blank image rather than an error, so the pixels have to fit; a photo scaled to
 * fit is a usable result, and the UI says it happened.
 */
export function outputSize(width: number, height: number): { width: number; height: number } {
  if (width * height <= MAX_CANVAS_PIXELS) return { width, height };
  const scale = Math.sqrt(MAX_CANVAS_PIXELS / (width * height));
  return fitWithin(width, height, Math.floor(width * scale), Math.floor(height * scale));
}

/** Decode one file and re-encode it as JPEG or PNG. */
export async function convertHeicFile(file: File, options: HeicOptions): Promise<HeicConversion> {
  const { format, quality } = validateOptions(options);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const box = readFtypBrand(bytes);
  const kind = box ? classifyBrand(box) : 'other';
  if (kind === 'avif') {
    throw new HeicDecodeError(
      'heicIsAvif',
      `"${file.name}" is an AVIF file. AVIF is not supported here — it is the same container with AV1 inside, which this decoder cannot read. Browsers open AVIF on their own, so the Image Format Converter handles it.`,
      { name: file.name },
    );
  }
  if (kind !== 'heif') {
    throw new HeicDecodeError('heicNotHeic', `"${file.name}" is not a HEIC or HEIF file.`, {
      name: file.name,
    });
  }
  const decoded = await decodeHeif(bytes, await loadLibheif());
  const out = outputSize(decoded.width, decoded.height);
  const bitmap = await createImageBitmap(decoded.pixels);
  try {
    const blob = await drawToBlob(bitmap, out.width, out.height, format, quality);
    return {
      sourceName: file.name,
      sourceSize: file.size,
      name: outputName(file.name, format),
      blob,
      width: out.width,
      height: out.height,
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
      imageCount: decoded.imageCount,
    };
  } finally {
    bitmap.close();
  }
}

/** Convert a batch, keeping going past a file that fails. */
export async function convertHeicFiles(
  files: File[],
  options: HeicOptions,
  onProgress?: (done: number, total: number) => void,
): Promise<{ results: HeicConversion[]; failures: HeicFailure[] }> {
  validateOptions(options);
  const results: HeicConversion[] = [];
  const failures: HeicFailure[] = [];
  const taken = new Set<string>();
  for (const [index, file] of files.entries()) {
    try {
      const converted = await convertHeicFile(file, options);
      results.push({ ...converted, name: uniqueName(converted.name, taken) });
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
export async function zipConversions(results: HeicConversion[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const r of results) zip.file(r.name, await r.blob.arrayBuffer());
  return zip.generateAsync({ type: 'blob' });
}
