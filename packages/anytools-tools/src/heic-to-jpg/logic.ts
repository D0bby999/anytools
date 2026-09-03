import { MAX_CANVAS_PIXELS, drawToBlob } from '../shared/canvas-image';
import { type HeifError, type LibheifModule, loadLibheif } from '../shared/libheif-loader';

export type HeicFormat = 'jpeg' | 'png';
export type HeicOptions = { format: HeicFormat; quality: number };

export type HeicConversion = {
  sourceName: string;
  sourceSize: number;
  name: string;
  blob: Blob;
  width: number;
  height: number;
  /** Top-level images in the container. A burst or a Live Photo still has more than one. */
  imageCount: number;
};

export type HeicFailure = { name: string; message: string };

export class HeicDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeicDecodeError';
  }
}

/** What the file picker accepts. `.hif` is Canon's spelling of the same container. */
export const HEIC_EXTENSIONS = ['.heic', '.heif', '.hif'] as const;

/**
 * ISO-BMFF brands libheif can open. A HEIC from an iPhone is `heic`; `mif1`/`msf1` are the
 * generic image and image-sequence brands Android and some cameras write.
 */
const HEIF_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'hevm',
  'hevs',
  'mif1',
  'mif2',
  'msf1',
  'heif',
]);

/** AV1 in the same container. Different codec, and browsers already open it natively. */
const AVIF_BRANDS = new Set(['avif', 'avis', 'avio']);

export type FtypBox = { majorBrand: string; compatibleBrands: string[] };

const fourcc = (bytes: Uint8Array, at: number) =>
  String.fromCharCode(...bytes.subarray(at, at + 4));

/**
 * Read the `ftyp` box every ISO-BMFF file opens with: 4-byte size, the literal `ftyp`, the major
 * brand, a minor version, then the compatible-brand list. Extensions lie and `file.type` is empty
 * on Windows for .heic, so the bytes are the only reliable signal.
 */
export function readFtypBrand(bytes: Uint8Array): FtypBox | null {
  if (bytes.length < 16 || fourcc(bytes, 4) !== 'ftyp') return null;
  const declared = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0);
  const end = Math.min(declared > 0 ? declared : bytes.length, bytes.length);
  const compatibleBrands: string[] = [];
  for (let at = 16; at + 4 <= end; at += 4) compatibleBrands.push(fourcc(bytes, at));
  return { majorBrand: fourcc(bytes, 8), compatibleBrands };
}

/** True when libheif should be able to open this. Checks the compatible list, not just major. */
export function isHeifBrand(box: FtypBox): boolean {
  return [box.majorBrand, ...box.compatibleBrands].some((b) => HEIF_BRANDS.has(b));
}

export function isAvifBrand(box: FtypBox): boolean {
  return [box.majorBrand, ...box.compatibleBrands].some((b) => AVIF_BRANDS.has(b));
}

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
    throw new HeicDecodeError(`Unsupported output format "${String(options.format)}".`);
  }
  if (!Number.isFinite(options.quality) || options.quality <= 0 || options.quality > 1) {
    throw new HeicDecodeError('JPEG quality must be greater than 0 and at most 1.');
  }
  return options;
}

/** `photo.HEIC` → `photo.jpg`. Any other extension keeps its name and gains the new one. */
export function outputName(sourceName: string, format: HeicFormat): string {
  const base = sourceName.replace(/\.(heic|heif|hif)$/i, '') || 'image';
  return `${base}.${format === 'jpeg' ? 'jpg' : 'png'}`;
}

const isError = (v: unknown): v is HeifError =>
  typeof v === 'object' && v !== null && typeof (v as HeifError).code === 'number';

/**
 * The image the file is *about*. A Live Photo or a burst holds several top-level images; the
 * container names one of them as primary and that is the frame Photos shows. Falling back to the
 * first id keeps files with a missing `pitm` box working.
 */
function primaryHandle(lib: LibheifModule, ctx: object, ids: number[]) {
  const primary = lib.heif_js_context_get_primary_image_handle(ctx);
  if (primary && !isError(primary)) return primary;
  const first = ids[0] !== undefined ? lib.heif_js_context_get_image_handle(ctx, ids[0]) : null;
  if (!first || isError(first)) {
    throw new HeicDecodeError('This HEIC file has no image that could be opened.');
  }
  return first;
}

/** node has no ImageData; `display` only writes `.data`, so a structural stand-in is enough. */
function blankImageData(width: number, height: number): ImageData {
  if (typeof ImageData === 'function') return new ImageData(width, height);
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: 'srgb',
  } as ImageData;
}

export type DecodedHeif = { pixels: ImageData; width: number; height: number; imageCount: number };

/**
 * Decode the primary image to RGBA pixels.
 *
 * Takes the module rather than fetching it so the WASM path can be exercised from a test without
 * a browser. Orientation needs no work here: libheif applies the container's `irot`/`imir`
 * transforms while decoding, so the pixels come out the way the photo was taken.
 */
export async function decodeHeif(bytes: Uint8Array, lib: LibheifModule): Promise<DecodedHeif> {
  const ctx = lib.heif_context_alloc();
  let image: { free(): void } | null = null;
  try {
    const err = lib.heif_context_read_from_memory(ctx, bytes);
    if (err?.code !== 0) {
      // libheif's own messages already end in a full stop ("File size too small.").
      const detail = err?.message?.replace(/\.*\s*$/, '');
      throw new HeicDecodeError(
        `This file could not be read as HEIC${detail ? `: ${detail}` : ''}.`,
      );
    }
    const ids = lib.heif_js_context_get_list_of_top_level_image_IDs(ctx);
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new HeicDecodeError('This HEIC container holds no images.');
    }
    const img = new lib.HeifImage(primaryHandle(lib, ctx, ids));
    image = img;
    const width = img.get_width();
    const height = img.get_height();
    if (!(width > 0 && height > 0)) {
      throw new HeicDecodeError('This HEIC image reports a size of zero and cannot be converted.');
    }
    if (width * height > MAX_CANVAS_PIXELS) {
      throw new HeicDecodeError(
        `This image is ${width}×${height} (${((width * height) / 1_000_000).toFixed(1)} megapixels), above what browsers reliably draw on a canvas.`,
      );
    }
    const pixels = await new Promise<ImageData>((resolve, reject) => {
      img.display(blankImageData(width, height), (result) =>
        result
          ? resolve(result)
          : reject(new HeicDecodeError('The HEIC image could not be decoded.')),
      );
    });
    return { pixels, width, height, imageCount: ids.length };
  } finally {
    // Order matters: the handle belongs to the context, so release it first.
    image?.free();
    lib.heif_context_free(ctx);
  }
}

/** Decode one file and re-encode it as JPEG or PNG. */
export async function convertHeicFile(file: File, options: HeicOptions): Promise<HeicConversion> {
  const { format, quality } = validateOptions(options);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const box = readFtypBrand(bytes);
  if (!box || !isHeifBrand(box)) {
    throw new HeicDecodeError(
      isAvifBrand(box ?? { majorBrand: '', compatibleBrands: [] })
        ? `"${file.name}" is an AVIF file, not HEIC. Browsers open AVIF directly — use the Image Format Converter.`
        : `"${file.name}" is not a HEIC or HEIF file.`,
    );
  }
  const decoded = await decodeHeif(bytes, await loadLibheif());
  const bitmap = await createImageBitmap(decoded.pixels);
  try {
    const blob = await drawToBlob(bitmap, decoded.width, decoded.height, format, quality);
    return {
      sourceName: file.name,
      sourceSize: file.size,
      name: outputName(file.name, format),
      blob,
      width: decoded.width,
      height: decoded.height,
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
  for (const [index, file] of files.entries()) {
    try {
      results.push(await convertHeicFile(file, options));
    } catch (e) {
      failures.push({ name: file.name, message: e instanceof Error ? e.message : String(e) });
    }
    onProgress?.(index + 1, files.length);
  }
  return { results, failures };
}

/** Bundle a finished batch. Names are already unique per source file. */
export async function zipConversions(results: HeicConversion[]): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const r of results) zip.file(r.name, await r.blob.arrayBuffer());
  return zip.generateAsync({ type: 'blob' });
}
