/**
 * Stamp text or a logo across a batch of images, entirely in the browser.
 *
 * Unlike watermark-pdf, which must embed a font to draw text into a PDF's own drawing model,
 * this draws straight onto a `<canvas>` with `ctx.fillText` — so Vietnamese, Greek, Cyrillic AND
 * CJK all just work, limited only by the fonts installed on the user's machine, not by anything
 * this tool ships. `loadBitmap`, the EXIF-orientation decode, the 16.7 MP canvas ceiling and the
 * JPEG-on-transparency fix are the shared canvas-image helper's job and reused as-is.
 *
 * Split across three files to stay under the repo's 200-line budget for `logic.ts`: pure
 * placement math is in `geometry.ts`, canvas drawing is in `render.ts` (needs a real `<canvas>`,
 * so it is not unit-testable under happy-dom), and this file is the orchestration — validation,
 * batching, naming, zipping — plus a re-export of both so `./logic` stays the one import path
 * `ui.tsx` and `logic.test.ts` use.
 */
import { type OutputFormat, fitWithin, loadBitmap } from '../shared/canvas-image';
import { ToolError } from '../shared/tool-error';
import type { WatermarkOptions } from './geometry';
import { renderWatermarked, resolveMark } from './render';

export * from './geometry';
export type { ResolvedMark } from './render';
export { renderWatermarked, resolveMark } from './render';

export type WatermarkResult = {
  /** Position in the batch's `files` array — pairs a result to its original file for a preview. */
  sourceIndex: number;
  sourceName: string;
  name: string;
  blob: Blob;
  format: OutputFormat;
  width: number;
  height: number;
  sizeBefore: number;
  sizeAfter: number;
};

export type WatermarkFailure = {
  name: string;
  message: string;
  code: string;
  params: Record<string, string | number>;
};

export class WatermarkImageError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'WatermarkImageError';
  }
}

export function formatFromMime(mime: string): OutputFormat {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpeg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

export function resolveFormat(
  choice: WatermarkOptions['format'],
  sourceMime: string,
): OutputFormat {
  return choice === 'original' ? formatFromMime(sourceMime) : choice;
}

export function outputName(sourceName: string, format: OutputFormat): string {
  const base = sourceName.replace(/\.[^.]+$/, '') || 'image';
  return `${base}-watermarked.${format === 'jpeg' ? 'jpg' : format}`;
}

/** Case-insensitive: a zip is extracted onto a case-insensitive folder on macOS and Windows. */
export function uniqueName(name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

function validate(opts: WatermarkOptions): void {
  if (opts.kind === 'text' && !opts.text.trim()) {
    throw new WatermarkImageError(
      'watermarkTextEmpty',
      'Type the text you want stamped on the images.',
    );
  }
  if (!(opts.opacity > 0 && opts.opacity <= 1)) {
    throw new WatermarkImageError('opacityRange', 'Opacity must be above 0 and at most 1.');
  }
}

export async function watermarkImage(
  file: File,
  opts: WatermarkOptions,
  logo?: ImageBitmap,
): Promise<WatermarkResult> {
  validate(opts);
  const bitmap = await loadBitmap(file);
  try {
    const format = resolveFormat(opts.format, file.type);
    const mark = resolveMark(opts, bitmap.width, logo);
    const blob = await renderWatermarked(bitmap, mark, opts, format);
    return {
      sourceIndex: 0, // overwritten by watermarkImages with the file's batch position
      sourceName: file.name,
      name: outputName(file.name, format),
      blob,
      format,
      width: bitmap.width,
      height: bitmap.height,
      sizeBefore: file.size,
      sizeAfter: blob.size,
    };
  } finally {
    bitmap.close();
  }
}

/** Process a batch, keeping going past a file that fails. The logo (if any) is decoded once. */
export async function watermarkImages(
  files: File[],
  opts: WatermarkOptions,
  logoFile: File | null,
  onProgress?: (done: number, total: number) => void,
): Promise<{ results: WatermarkResult[]; failures: WatermarkFailure[] }> {
  validate(opts);
  if (opts.kind === 'image' && !logoFile) {
    throw new WatermarkImageError('watermarkLogoMissing', 'Choose a logo image to stamp.');
  }
  const logo = opts.kind === 'image' ? await loadBitmap(logoFile as File) : null;
  try {
    const results: WatermarkResult[] = [];
    const failures: WatermarkFailure[] = [];
    const taken = new Set<string>();
    for (const [index, file] of files.entries()) {
      try {
        const r = await watermarkImage(file, opts, logo ?? undefined);
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
  } finally {
    logo?.close();
  }
}

/** Render a capped-size preview of one file for the live "before you export" canvas. */
export async function previewWatermark(
  file: File,
  opts: WatermarkOptions,
  logo: ImageBitmap | undefined,
  maxSide: number,
): Promise<Blob> {
  const bitmap = await loadBitmap(file);
  try {
    const size = fitWithin(bitmap.width, bitmap.height, maxSide, maxSide);
    const format = resolveFormat(opts.format, file.type);
    const mark = resolveMark(opts, size.width, logo);
    return await renderWatermarked(bitmap, mark, opts, format, size);
  } finally {
    bitmap.close();
  }
}

/** Bundle a finished batch. Names were made unique when the batch was built. */
export async function zipWatermarked(results: WatermarkResult[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const r of results) zip.file(r.name, await r.blob.arrayBuffer());
  return zip.generateAsync({ type: 'blob' });
}
