/**
 * Everything that talks to libheif. `logic.ts` owns the file-level work either side of it —
 * brand checks, output names, the canvas, the zip — and imports this; nothing here imports back.
 */
import {
  type HeifImage,
  type LibheifModule,
  isHeifError,
  isHeifOk,
} from '../shared/libheif-loader';

export class HeicDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeicDecodeError';
  }
}

/**
 * Ceiling on what is decoded into memory, well above any camera (a 48 MP iPhone ProRAW HEIC is
 * 48.8 MP). Not the canvas limit — that one is handled by scaling, see `outputSize`. This one
 * exists because the pixel buffer is width × height × 4 bytes and a malformed `ispe` box can
 * claim 65535 × 65535, where the allocation fails with a RangeError instead of a sentence.
 */
export const MAX_DECODE_PIXELS = 100_000_000;

/** A decode that neither finishes nor fails leaves the button stuck on "Converting…". */
const DECODE_TIMEOUT_MS = 60_000;

/**
 * The image the file is *about*. A Live Photo or a burst holds several top-level images; the
 * container names one of them as primary and that is the frame Photos shows. Falling back to the
 * first id keeps files with a missing `pitm` box working.
 */
function primaryHandle(lib: LibheifModule, ctx: object, ids: number[]) {
  const primary = lib.heif_js_context_get_primary_image_handle(ctx);
  if (primary && !isHeifError(primary)) return primary;
  const first = ids[0] !== undefined ? lib.heif_js_context_get_image_handle(ctx, ids[0]) : null;
  if (!first || isHeifError(first)) {
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

/**
 * Run libheif's decode and settle exactly once.
 *
 * `display` hands the work to a `setTimeout` of its own, so a throw inside it lands on the
 * window's error handler rather than in our `await`: without the timeout the promise would never
 * settle and the button would read "Converting…" for the rest of the session. The try/catch
 * covers the synchronous half — an embind failure raised while the call is being set up.
 */
function decodeToPixels(img: HeifImage, target: ImageData): Promise<ImageData> {
  return new Promise<ImageData>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(new HeicDecodeError('Decoding this image took too long and was stopped.')),
        ),
      DECODE_TIMEOUT_MS,
    );
    try {
      img.display(target, (result) => {
        finish(() =>
          result
            ? resolve(result)
            : reject(new HeicDecodeError('The HEIC image could not be decoded.')),
        );
      });
    } catch (e) {
      finish(() =>
        reject(
          new HeicDecodeError(
            `The HEIC image could not be decoded: ${e instanceof Error ? e.message : String(e)}`,
          ),
        ),
      );
    }
  });
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
    if (!isHeifOk(err)) {
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
    if (width * height > MAX_DECODE_PIXELS) {
      throw new HeicDecodeError(
        `This image claims to be ${width}×${height} (${((width * height) / 1_000_000).toFixed(1)} megapixels), too large to decode in a browser tab.`,
      );
    }
    const pixels = await decodeToPixels(img, blankImageData(width, height));
    return { pixels, width, height, imageCount: ids.length };
  } finally {
    // Order matters: the handle belongs to the context, so release it first.
    image?.free();
    lib.heif_context_free(ctx);
  }
}
