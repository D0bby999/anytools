/**
 * Load @jsquash/jpeg's MozJPEG encoder and @jsquash/oxipng's PNG optimiser, pointed at our own
 * copies of their WASM binaries — never a bundler-guessed path, never a CDN.
 *
 * Same shape as zxing-loader.ts: an idempotent `init()` per codec, a self-hosted
 * `/third-party/jsquash/…` URL, and the WASM fetched lazily on first encode — never at page
 * load. `copy-vendor-assets.mjs` stages the two binaries this file needs (manifest key
 * `jsquash`); see THIRD-PARTY-NOTICES.md for the licences travelling with them.
 *
 * Only ENCODERS are loaded here, deliberately:
 *
 *  - @jsquash/jpeg's `decode` is never imported. Every caller already has pixels from a
 *    browser-native decode (`createImageBitmap`, or pdf.js for compress-pdf's embedded
 *    images), so there is nothing for MozJPEG's own JPEG decoder to do.
 *  - @jsquash/png is not used AT ALL, despite being pinned in package.json. Its own README
 *    (`encode.js`'s doc comment, jsquash 3.1.1) says: "You may want to use @jsquash/oxipng
 *    instead. It can both optimise and encode to PNG directly from raw image data (8-bit
 *    images only)." `optimise_raw()` takes the canvas's raw RGBA pixels and returns a
 *    complete, already-optimised PNG file in one step — @jsquash/png's own encoder would only
 *    produce a bigger intermediate PNG for oxipng to re-shrink a moment later.
 *
 * oxipng's own `init()` picks a multi-threaded build only inside a Worker with
 * `hardwareConcurrency > 1` (see its `optimise.js`) — this module always runs on the main
 * thread, so it always takes the single-threaded path and never needs the
 * `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` headers threading would require
 * (this site cannot send COEP; see onnx-loader.ts for why).
 */
import { ToolError } from './tool-error';

/** Where copy-vendor-assets.mjs stages the two binaries this module uses. */
const JPEG_ENC_WASM_URL = '/third-party/jsquash/enc/mozjpeg_enc.wasm';
const OXIPNG_WASM_URL = '/third-party/jsquash/oxipng/squoosh_oxipng_bg.wasm';

export class ImageCodecError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'ImageCodecError';
  }
}

/** MozJPEG's own `color_space` enum (`@jsquash/jpeg/codec/enc/mozjpeg_enc.d.ts`), not re-exported. */
const MOZJPEG_COLOR_SPACE = { GRAYSCALE: 1, YCBCR: 3 } as const;

type JpegEncodeModule = typeof import('@jsquash/jpeg/encode.js');
let jpegEncoder: Promise<JpegEncodeModule> | null = null;

/**
 * Import the encoder and register the WASM override before anything can trigger a fetch.
 * The promise is cached rather than the module so two callers on a cold page share one
 * instantiation; a rejected promise is dropped so a transient failure can be retried.
 */
async function loadJpegEncoder(): Promise<JpegEncodeModule> {
  if (!jpegEncoder) {
    jpegEncoder = (async () => {
      const mod = await import('@jsquash/jpeg/encode.js');
      // A single-argument call (not a WebAssembly.Module) makes `init` treat it as the
      // overrides object — see the `arguments.length === 1` branch in encode.js.
      await mod.init({
        locateFile: (path: string) => (path.endsWith('.wasm') ? JPEG_ENC_WASM_URL : path),
      });
      return mod;
    })();
    jpegEncoder.catch(() => {
      jpegEncoder = null;
    });
  }
  return jpegEncoder;
}

type OxipngModule = typeof import('@jsquash/oxipng/optimise.js');
let oxipngEncoder: Promise<OxipngModule> | null = null;

async function loadOxipng(): Promise<OxipngModule> {
  if (!oxipngEncoder) {
    oxipngEncoder = (async () => {
      const mod = await import('@jsquash/oxipng/optimise.js');
      // wasm-bindgen's `init` accepts a plain URL string directly (it does `fetch(input)`
      // itself) — no manual ArrayBuffer fetch needed, unlike the emscripten build above.
      await mod.init(OXIPNG_WASM_URL);
      return mod;
    })();
    oxipngEncoder.catch(() => {
      oxipngEncoder = null;
    });
  }
  return oxipngEncoder;
}

/**
 * Encode pixels as a JPEG via MozJPEG.
 *
 * `qualityPercent` is 0–100 — JPEG's own convention, NOT the 0–1 scale `canvas.toBlob` and this
 * repo's quality sliders use. Callers porting a slider must multiply by 100.
 *
 * `grayscale` re-encodes as a genuine 1-component JFIF (PDF `DeviceGray`) rather than 3-component
 * YCbCr — compress-pdf uses this to avoid tripling the size of a black-and-white scan that was
 * grayscale in the source PDF.
 */
export async function encodeJpegMozjpeg(
  imageData: ImageData,
  qualityPercent: number,
  grayscale = false,
): Promise<ArrayBuffer> {
  try {
    const { default: encode } = await loadJpegEncoder();
    return await encode(imageData, {
      quality: Math.min(100, Math.max(1, Math.round(qualityPercent))),
      color_space: grayscale ? MOZJPEG_COLOR_SPACE.GRAYSCALE : MOZJPEG_COLOR_SPACE.YCBCR,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ImageCodecError(
      'jpegEncodeFailed',
      `The JPEG encoder failed to run (${detail}). This is a bug on our side, not a problem with your image.`,
      { detail },
    );
  }
}

/**
 * Encode pixels as an optimised PNG via oxipng's `optimise_raw` — see the module comment for
 * why @jsquash/png's own encoder is never called.
 */
export async function encodeOptimizedPng(imageData: ImageData, level = 2): Promise<ArrayBuffer> {
  try {
    const { default: optimise } = await loadOxipng();
    return await optimise(imageData, { level, interlace: false, optimiseAlpha: false });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ImageCodecError(
      'pngEncodeFailed',
      `The PNG optimiser failed to run (${detail}). This is a bug on our side, not a problem with your image.`,
      { detail },
    );
  }
}
