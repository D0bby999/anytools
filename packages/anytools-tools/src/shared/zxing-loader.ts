/**
 * Load zxing-wasm and point it at our own copy of the WASM binary.
 *
 * zxing-wasm ships `zxing_full.wasm` (~1.5 MB) as a file fetched at runtime, and its default
 * `locateFile` resolves that file to `https://fastly.jsdelivr.net/npm/zxing-wasm@<version>/...`.
 * Left alone, every scan on this site would contact a CDN — which contradicts the whole premise
 * of the site and would be blocked by the `connect-src 'self'` CSP anyway. So the binary is
 * staged into `public/third-party/zxing/` by scripts/copy-vendor-assets.mjs (manifest key
 * `zxing`), and the override below is the only thing that makes the library use it.
 *
 * Two other properties this module is responsible for:
 *
 *   1. The 1.5 MB binary must not be fetched on page load. `prepareZXingModule` with
 *      `fireImmediately: false` only records the overrides; the binary is fetched and
 *      instantiated on the first `readBarcodes`/`writeBarcode` call. The dynamic `import()`
 *      below likewise keeps the JS glue out of the page's initial chunks.
 *   2. The overrides object is a module-level constant, not a fresh literal per call.
 *      zxing-wasm decides whether to re-instantiate by shallow-comparing overrides, and a new
 *      arrow function each time compares unequal — which would re-download and re-instantiate
 *      the module on every scan.
 *
 * The version in package.json is pinned exactly (3.1.3, no caret) because the staged .wasm and
 * the JS glue are one unit: a lockfile drift to a build with different exports would load a
 * mismatched binary. The library itself documents this constraint.
 */
import type { ReadResult, ReaderOptions, WriterOptions } from 'zxing-wasm/full';

export type { ReadResult, ReaderOptions, WriterOptions };

/** Where copy-vendor-assets.mjs stages `dist/full/zxing_full.wasm`. Served from our origin. */
const WASM_URL = '/third-party/zxing/zxing_full.wasm';

export class BarcodeEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BarcodeEngineError';
  }
}

const OVERRIDES = {
  locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? WASM_URL : prefix + path),
};

type ZXingModule = typeof import('zxing-wasm/full');
let cached: Promise<ZXingModule> | null = null;

/**
 * Import the library and register the asset override before anything can trigger a fetch.
 *
 * The promise is cached rather than the module: two components calling this concurrently on a
 * cold page must share one instantiation, and a rejected promise is dropped so a transient
 * failure (offline on first use) can be retried.
 */
export async function loadZXing(): Promise<ZXingModule> {
  if (cached) return cached;
  cached = (async () => {
    const mod = await import('zxing-wasm/full');
    mod.prepareZXingModule({ overrides: OVERRIDES, fireImmediately: false });
    return mod;
  })();
  cached.catch(() => {
    cached = null;
  });
  return cached;
}

function engineError(e: unknown, what: string): BarcodeEngineError {
  const msg = e instanceof Error ? e.message : String(e);
  // A 404 on the .wasm is a deploy problem on our side, and it surfaces as an
  // instantiation/compile error that means nothing to a visitor. Say which it is.
  if (/wasm|magic|compile|instantiat|fetch|network/i.test(msg)) {
    return new BarcodeEngineError(
      'The barcode engine failed to load. This is a problem on our side, not with your input.',
    );
  }
  return new BarcodeEngineError(`${what}: ${msg}`);
}

/** Decode every symbol found in an image. Loads the engine on first call. */
export async function readBarcodes(
  input: Blob | ArrayBuffer | Uint8Array | ImageData,
  options?: ReaderOptions,
): Promise<ReadResult[]> {
  const mod = await loadZXing().catch((e) => {
    throw engineError(e, 'Could not start the barcode reader');
  });
  try {
    return await mod.readBarcodes(input, options);
  } catch (e) {
    throw engineError(e, 'Could not read this image');
  }
}

/**
 * Encode one symbol. Returns the SVG source and a PNG blob.
 *
 * zxing-wasm reports encoding failures in a `error` STRING on a resolved result rather than by
 * rejecting — an unchecked call returns `{ svg: '', image: null, error: '…' }`, which renders as
 * a blank barcode. Checking it here means no caller can miss it.
 */
export async function writeBarcode(
  text: string,
  options: WriterOptions,
): Promise<{ svg: string; png: Blob }> {
  const mod = await loadZXing().catch((e) => {
    throw engineError(e, 'Could not start the barcode writer');
  });
  let result: Awaited<ReturnType<ZXingModule['writeBarcode']>>;
  try {
    result = await mod.writeBarcode(text, options);
  } catch (e) {
    throw engineError(e, 'Could not encode this barcode');
  }
  if (result.error) throw new BarcodeEngineError(result.error);
  if (!result.svg || !result.image) {
    throw new BarcodeEngineError('The encoder returned an empty barcode.');
  }
  return { svg: result.svg, png: result.image };
}
