/**
 * Font subsetting via HarfBuzz's `hb-subset` C API, called directly through its raw WASM
 * exports — not through harfbuzzjs's documented `hb.js` wrapper, which only covers text shaping.
 *
 * `dist/harfbuzz-subset.wasm` (staged from the `harfbuzz` vendor-assets.json key into
 * `/third-party/harfbuzz/`) is a "standalone wasm" Emscripten build: `WebAssembly.Module.imports`
 * on it returns an empty array, so `WebAssembly.instantiate(bytes, {})` is the whole loading
 * story — no Emscripten JS runtime, no `fs`, nothing Node-specific, which is exactly why this
 * works in a browser at all (contrast `@visioncortex/vtracer`, dropped from this batch for
 * having no such build — see THIRD-PARTY-NOTICES.md). The function names and call sequence below
 * follow HarfBuzz's own public `hb-subset.h` API; the shape of it was cross-checked against
 * papandreou/subset-font (MIT), which drives the same wasm from Node with `fs.readFile` in place
 * of the `fetch` below — no code from that package is copied, only its choice of which dozen of
 * HarfBuzz's ~40 exported functions to call and in what order.
 *
 * Every pointer here is an offset into `instance.exports.memory`, not a JS object — HarfBuzz
 * manages its own arena inside the wasm's linear memory, and this module's job is marshalling
 * bytes across that boundary and freeing what it allocates, exactly as a native caller would.
 */

const WASM_URL = '/third-party/harfbuzz/harfbuzz-subset.wasm';

/** How harfbuzz.h defines `hb_blob_create`'s memory-mode enum. Only "writable" is used here. */
const HB_MEMORY_MODE_WRITABLE = 2;
/** `hb_subset_sets_t` tag for the layout-feature-tag set (harfbuzz-subset.h). */
const HB_SUBSET_SETS_LAYOUT_FEATURE_TAG = 6;

export class HbSubsetEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HbSubsetEngineError';
  }
}

/** The exported C functions this module calls, typed as the plain numeric pointers wasm uses. */
type HbSubsetExports = {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(ptr: number): void;
  hb_blob_create(
    data: number,
    length: number,
    mode: number,
    userData: number,
    destroy: number,
  ): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_data(blob: number, length: number): number;
  hb_blob_get_length(blob: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_clear(set: number): void;
  hb_set_add(set: number, value: number): void;
  hb_set_invert(set: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_unicode_set(input: number): number;
  hb_subset_input_set(input: number, tag: number): number;
  hb_subset_or_fail(face: number, input: number): number;
  _initialize?(): void;
};

let cached: Promise<HbSubsetExports> | null = null;

/** Fetch and instantiate the wasm once; every caller after the first reuses the same instance. */
async function loadEngine(): Promise<HbSubsetExports> {
  if (cached) return cached;
  cached = (async () => {
    const response = await fetch(WASM_URL).catch(() => {
      throw new HbSubsetEngineError('The font subsetting engine could not be downloaded.');
    });
    if (!response.ok) {
      throw new HbSubsetEngineError(
        `The font subsetting engine is missing from this site (HTTP ${response.status}).`,
      );
    }
    const bytes = await response.arrayBuffer();
    let instance: WebAssembly.Instance;
    try {
      instance = (await WebAssembly.instantiate(bytes, {})).instance;
    } catch (e) {
      throw new HbSubsetEngineError(
        `The font subsetting engine failed to start (${e instanceof Error ? e.message : String(e)}).`,
      );
    }
    const exports = instance.exports as unknown as HbSubsetExports;
    // Standalone-wasm reactor convention: run global constructors before anything else calls in.
    exports._initialize?.();
    return exports;
  })();
  cached.catch(() => {
    cached = null;
  });
  return cached;
}

/** Copy `bytes` into the module's own memory and hand back the pointer plus a free()-r. */
function allocCopy(hb: HbSubsetExports, bytes: Uint8Array): { ptr: number; free: () => void } {
  const ptr = hb.malloc(bytes.byteLength);
  if (ptr === 0) throw new HbSubsetEngineError('Out of memory inside the font subsetting engine.');
  new Uint8Array(hb.memory.buffer, ptr, bytes.byteLength).set(bytes);
  return { ptr, free: () => hb.free(ptr) };
}

/**
 * Subset `fontBytes` (a raw sfnt — ttf or otf, never woff/woff2) down to the glyphs needed for
 * `codepoints`, keeping every OpenType layout feature (ligatures, kerning, Vietnamese mark
 * positioning) rather than only the defaults hb-subset would keep otherwise.
 *
 * Every intermediate handle (blob/face/input) is destroyed in a `finally` so a thrown error
 * midway never leaks wasm-side memory that would otherwise sit there for the rest of the page's
 * life — this engine has no garbage collector of its own.
 */
export async function subsetSfnt(
  fontBytes: Uint8Array,
  codepoints: Iterable<number>,
): Promise<Uint8Array> {
  const hb = await loadEngine();

  const input = hb.hb_subset_input_create_or_fail();
  if (input === 0) {
    throw new HbSubsetEngineError('The font subsetting engine could not start a new subset job.');
  }

  const font = allocCopy(hb, fontBytes);
  let blob = 0;
  let face = 0;
  let subsetFace = 0;
  let resultBlob = 0;

  try {
    blob = hb.hb_blob_create(font.ptr, fontBytes.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
    // hb_face_create builds its face lazily and does not itself reject bad data — even garbage
    // bytes return a non-zero handle (checked against this exact build). The real validation
    // happens below at hb_subset_or_fail, which is where a corrupt or unrecognised font surfaces.
    face = hb.hb_face_create(blob, 0);
    hb.hb_blob_destroy(blob);
    blob = 0;

    // Keep every layout feature: clear the "keep" set then invert it, which hb-subset treats as
    // "all of them" rather than its narrower built-in default list.
    const layoutFeatures = hb.hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG);
    hb.hb_set_clear(layoutFeatures);
    hb.hb_set_invert(layoutFeatures);

    const unicodes = hb.hb_subset_input_unicode_set(input);
    let count = 0;
    for (const cp of codepoints) {
      hb.hb_set_add(unicodes, cp);
      count++;
    }
    if (count === 0) {
      throw new HbSubsetEngineError('No characters were given to keep in the subset.');
    }

    subsetFace = hb.hb_subset_or_fail(face, input);
    if (subsetFace === 0) {
      throw new HbSubsetEngineError(
        'HarfBuzz could not read this as a font — it may not be a TTF/OTF, or the file is corrupted.',
      );
    }

    resultBlob = hb.hb_face_reference_blob(subsetFace);
    const length = hb.hb_blob_get_length(resultBlob);
    if (length === 0) {
      throw new HbSubsetEngineError('The subset came back empty.');
    }
    const offset = hb.hb_blob_get_data(resultBlob, 0);
    // Copy out of wasm memory before it is freed below — the ArrayBuffer view is a live window
    // into an arena about to be destroyed, not a value the caller can keep past this function.
    return new Uint8Array(hb.memory.buffer, offset, length).slice();
  } finally {
    if (resultBlob) hb.hb_blob_destroy(resultBlob);
    if (subsetFace) hb.hb_face_destroy(subsetFace);
    if (face) hb.hb_face_destroy(face);
    if (blob) hb.hb_blob_destroy(blob);
    hb.hb_subset_input_destroy(input);
    font.free();
  }
}
