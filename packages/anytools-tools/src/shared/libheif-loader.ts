/**
 * Load libheif and point it at our own copy of the WASM binary.
 *
 * LICENCE — read before changing how this file loads anything. libheif and libde265 are
 * **LGPL-3.0**, the only copyleft component on this MIT site. `libheif-js` ships three builds:
 *
 *   libheif-js                    asm.js, 2.1 MB of JavaScript — the library compiled INTO a script
 *   libheif-js/wasm-bundle        the WASM inlined as base64 inside the JS
 *   libheif-js/libheif-wasm/…     the JS glue plus a separate libheif.wasm  ← the one used here
 *
 * Only the third keeps the LGPL work in **separate files** a user can replace with their own
 * compatible build, which is how LGPL-3.0 §4(d)(1) is satisfied without relicensing this
 * repository. The other two would fuse LGPL object code into our own bundle. `libheif-js/wasm`
 * looks like the right entry point and is not: it reads the binary with `fs.readFileSync`.
 *
 * Both files are loaded from `/third-party/libheif/` at runtime rather than imported, so neither
 * the WASM nor the glue enters a chunk of ours. That is not only cleaner licensing: the glue is a
 * UMD file that calls `require('fs')` on its Node branch, which fails a webpack browser build
 * outright ("Module not found: Can't resolve 'fs'"). Loading it as a plain script sidesteps both
 * problems at once. It defines a global `libheif` — the factory — when it runs.
 *
 * See THIRD-PARTY-NOTICES.md → "libheif / libde265 (LGPL-3.0)" for the full notice, and
 * public/third-party/libheif/LICENSE for the licence text served with the binary.
 *
 * The version in package.json is pinned exactly (1.19.8, no caret): the staged .wasm and the JS
 * glue are one unit, and a lockfile drift to a build with different exports would load a
 * mismatched binary.
 */

/** Where copy-vendor-assets.mjs stages the pair. Served from our origin, never a CDN. */
const SCRIPT_URL = '/third-party/libheif/libheif.js';
const WASM_URL = '/third-party/libheif/libheif.wasm';

/**
 * Backstop for a load that neither succeeds nor aborts. Emscripten reports a 404 or a corrupt
 * binary through `onAbort`, but a hang leaves the UI saying "Converting…" forever, which is a
 * worse failure than an error message.
 */
const LOAD_TIMEOUT_MS = 60_000;

export class HeicEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeicEngineError';
  }
}

/**
 * What libheif hands back from most calls.
 *
 * `code` is NOT the plain integer the C API documents. embind exposes `heif_error_code` as an
 * enum, and a value of an embind enum is an object — `{ value: 0 }` under a class whose name is
 * mangled — so the success object is `{ code: <enum 0>, subcode: <enum 0>, message: 'Success' }`.
 * Typing it as a number here is what made `err.code !== 0` true for every file that decoded
 * perfectly, and every valid HEIC was rejected with "could not be read as HEIC: Success"
 * (found in review, 2026-09-03, on three real files). Read the code through `heifErrorValue`.
 */
export type HeifErrorCode = { value: number };
export type HeifError = {
  code: HeifErrorCode | number;
  subcode?: HeifErrorCode | number;
  message?: string;
};

/**
 * The numeric error code, or null when `value` is not one of these objects at all.
 *
 * Accepts a plain number too: the enum wrapper is a property of how this build was compiled, and
 * a future one returning the raw int should not silently start reporting failures again.
 */
export function heifErrorValue(value: unknown): number | null {
  if (typeof value !== 'object' || value === null) return null;
  const code = (value as { code?: unknown }).code;
  if (typeof code === 'number') return code;
  if (typeof code === 'object' && code !== null) {
    const inner = (code as { value?: unknown }).value;
    if (typeof inner === 'number') return inner;
  }
  return null;
}

/**
 * Does this look like an error object rather than an image handle?
 *
 * Handles come back as embind objects with no `code` property, so the presence of a readable
 * code is the discriminator. `heif_error_Ok` (0) is still an "error object": a call that returns
 * one returned a status, not a handle.
 */
export const isHeifError = (value: unknown): value is HeifError => heifErrorValue(value) !== null;

/** True only for `heif_error_Ok`. */
export const isHeifOk = (value: unknown): boolean => heifErrorValue(value) === 0;

/** Opaque embind handles. Never dereferenced here — only passed back into the module. */
export type HeifContext = object;
export type HeifImageHandle = object;

export type HeifImage = {
  get_width(): number;
  get_height(): number;
  /**
   * Decode into `target` and hand it back, or hand back null on failure. Asynchronous by way of
   * setTimeout, so a large image does not block the frame that started it.
   */
  display(target: ImageData, done: (result: ImageData | null) => void): void;
  free(): void;
};

/**
 * The subset of the module this repository uses.
 *
 * Written by hand rather than taken from the shipped `libheif.d.ts`, which types the embind
 * exports but not `HeifImage`/`HeifDecoder` — those are attached by the wrapper's own JavaScript
 * after the module is built. Note that the shipped `HeifImage.prototype.is_primary` is unusable:
 * it calls `heif_image_handle_is_primary_image` as a bare global rather than off the module, so
 * it throws a ReferenceError. Hence the primary image is resolved through the context instead.
 */
export type LibheifModule = {
  heif_context_alloc(): HeifContext;
  heif_context_free(ctx: HeifContext): void;
  heif_context_read_from_memory(ctx: HeifContext, data: Uint8Array): HeifError;
  heif_js_context_get_list_of_top_level_image_IDs(ctx: HeifContext): number[] | HeifError;
  heif_js_context_get_primary_image_handle(ctx: HeifContext): HeifImageHandle | HeifError;
  heif_js_context_get_image_handle(ctx: HeifContext, id: number): HeifImageHandle | HeifError;
  heif_get_version(): string;
  HeifImage: new (handle: HeifImageHandle) => HeifImage;
};

type EmscriptenOptions = {
  wasmBinary: ArrayBuffer | Uint8Array;
  locateFile: (path: string) => string;
  onRuntimeInitialized: () => void;
  onAbort: (what: unknown) => void;
  printErr: (text: string) => void;
};
export type LibheifFactory = (options: EmscriptenOptions) => unknown;

/**
 * Build the module and resolve once its WASM is live.
 *
 * `wasmBinary` is not optional. This build was compiled with synchronous WASM instantiation, so
 * emscripten wants the bytes in hand at construction time; left to fetch them itself in a browser
 * it fails with "sync fetching of the wasm failed: you can preload it to Module['wasmBinary']"
 * (observed in the browser lane, 2026-09-03 — the unit tests could not see it because node reads
 * the file straight off disk). `locateFile` stays as documentation of where the binary lives and
 * as a backstop for a future build that fetches it.
 *
 * Emscripten's MODULARIZE output here returns the very options object it was given, augmented
 * with the exports, and signals readiness through `onRuntimeInitialized` — it exposes no `ready`
 * promise. Both the returned value and the object passed in are therefore accepted, which matters
 * because a synchronous instantiation fires that callback BEFORE the factory call returns.
 */
export function instantiateLibheif(
  factory: LibheifFactory,
  wasmBinary: ArrayBuffer | Uint8Array,
): Promise<LibheifModule> {
  return new Promise<LibheifModule>((resolve, reject) => {
    let created: unknown;
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
          reject(new HeicEngineError('The HEIC decoder did not finish loading. Try again.')),
        ),
      LOAD_TIMEOUT_MS,
    );
    const options: EmscriptenOptions = {
      wasmBinary,
      locateFile: () => WASM_URL,
      onRuntimeInitialized: () =>
        finish(() => resolve((created ?? options) as unknown as LibheifModule)),
      onAbort: (what) =>
        finish(() =>
          reject(
            new HeicEngineError(
              `The HEIC decoder failed to start (${String(what)}). This is a problem on our side, not with your file.`,
            ),
          ),
        ),
      // Emscripten writes its own diagnostics to console.error. The rejection above carries the
      // message; a second copy in the console is noise.
      printErr: () => {},
    };
    try {
      created = factory(options);
    } catch (e) {
      finish(() =>
        reject(
          new HeicEngineError(
            `The HEIC decoder failed to start: ${e instanceof Error ? e.message : String(e)}`,
          ),
        ),
      );
    }
  });
}

type WindowWithLibheif = Window & typeof globalThis & { libheif?: LibheifFactory };

/** Fetch the glue with a script tag and hand back the global factory it defines. */
async function loadFactory(): Promise<LibheifFactory> {
  if (typeof document === 'undefined') {
    throw new HeicEngineError('The HEIC decoder only runs in a browser.');
  }
  const w = window as WindowWithLibheif;
  if (typeof w.libheif === 'function') return w.libheif;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(
        new HeicEngineError(
          'The HEIC decoder failed to download. This is a problem on our side, not with your file.',
        ),
      );
    document.head.append(script);
  });
  if (typeof w.libheif !== 'function') {
    throw new HeicEngineError('The HEIC decoder loaded but did not register itself.');
  }
  return w.libheif;
}

/** Fetch the binary ourselves — see instantiateLibheif for why emscripten cannot. */
async function fetchWasm(): Promise<ArrayBuffer> {
  const response = await fetch(WASM_URL).catch(() => {
    throw new HeicEngineError('The HEIC decoder could not be downloaded. Check your connection.');
  });
  if (!response.ok) {
    throw new HeicEngineError(
      `The HEIC decoder is missing from this site (HTTP ${response.status}). This is a problem on our side, not with your file.`,
    );
  }
  return response.arrayBuffer();
}

let cached: Promise<LibheifModule> | null = null;

/**
 * Load the glue and instantiate it against our staged binary.
 *
 * The promise is cached rather than the module: two conversions started together on a cold page
 * must share one download of a 1 MB binary. A rejected promise is dropped so a transient failure
 * (offline on first use) can be retried. Nothing is fetched until someone actually converts a
 * file — that is the property the browser lane checks by opening the page and looking for a
 * request to /third-party/libheif/ before any upload.
 */
export async function loadLibheif(): Promise<LibheifModule> {
  if (cached) return cached;
  cached = (async () => {
    const [factory, wasmBinary] = await Promise.all([loadFactory(), fetchWasm()]);
    return instantiateLibheif(factory, wasmBinary);
  })();
  cached.catch(() => {
    cached = null;
  });
  return cached;
}
