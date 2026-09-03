/**
 * Load onnxruntime-web from this origin, and hand tools a cached InferenceSession.
 *
 * Three things this module exists to guarantee:
 *
 *  1. NOTHING IS FETCHED FROM A CDN. Left alone, ORT resolves both `ort-wasm-simd-threaded.mjs`
 *     and `ort-wasm-simd-threaded.wasm` relative to the script that loaded it — which, for a
 *     bundle served by us, is our origin, but for any of the library's documented set-ups is
 *     jsdelivr. `env.wasm.wasmPaths` is set to an explicit absolute prefix so there is no
 *     resolution to get wrong. Read in 1.29.0's own bundle: a STRING wasmPaths makes ORT import
 *     the glue `.mjs` from `<prefix>ort-wasm-simd-threaded.mjs` and locate the binary at
 *     `<prefix>ort-wasm-simd-threaded.wasm`. Both files are staged into public/third-party/onnx/
 *     by scripts/copy-vendor-assets.mjs (manifest key `onnx`) from the very package version
 *     pinned in package.json, so the glue and the binary can never drift apart.
 *
 *  2. NO CROSS-ORIGIN ISOLATION IS REQUIRED. ORT's default `numThreads: 0` means "one thread per
 *     core", and threads need SharedArrayBuffer, which needs COOP+COEP headers. This site cannot
 *     send those: COEP breaks the AdSense iframes. So `numThreads = 1` — explicitly, not by
 *     accident — and `proxy = false`, which would otherwise spawn a worker from a blob URL.
 *     Single-threaded WASM is roughly 2× slower than a 4-thread run; that is the price, and it is
 *     paid on purpose. (1.29.0 ships only the `-threaded` binary; single-threading is a runtime
 *     flag, not a different file, so there is no lighter build to switch to.)
 *
 *  3. THE MODEL AND THE RUNTIME ARE DOWNLOADED ONCE. ~19 MB per page load would make the tool
 *     unusable on a phone. Both go through the Cache API under `anytools-models`, keyed by URL,
 *     and the byte counter feeds a real progress bar rather than a mute spinner. The runtime is
 *     handed to ORT as `env.wasm.wasmBinary` precisely so that it goes through that cache:
 *     measured on 2026-09-03, letting ORT fetch the file itself re-transferred all 14 MB after
 *     every reload, because Next serves public/ with `Cache-Control: public, max-age=0` and the
 *     revalidation came back 200 rather than 304.
 *
 * The `import()` is dynamic and lives inside the function: importing this module must not pull
 * ORT into any page's initial chunk.
 */
import type { InferenceSession } from 'onnxruntime-web';

/** Where copy-vendor-assets.mjs stages the runtime. Trailing slash required — ORT concatenates. */
const ASSET_BASE = '/third-party/onnx/';

/** The 14 MB binary. Fetched by us, not by ORT, so that it lands in the Cache API. */
const WASM_URL = `${ASSET_BASE}ort-wasm-simd-threaded.wasm`;

/** Cache Storage bucket for model weights. Shared by every model-backed tool. */
export const MODEL_CACHE_NAME = 'anytools-models';

export class OnnxEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnnxEngineError';
  }
}

/**
 * Which file is downloading, plus bytes so far / total from Content-Length. `total` is 0 when
 * the server did not say, or when the bytes came from the cache in one piece.
 */
export type ModelProgress = { file: 'engine' | 'model'; loaded: number; total: number };

type OrtModule = typeof import('onnxruntime-web/wasm');

let runtime: Promise<OrtModule> | null = null;

/**
 * Import the wasm-only build and configure it before anything can trigger a fetch.
 *
 * `onnxruntime-web/wasm` rather than the default entry: the default also carries the WebGL
 * backend, which this site never selects. The promise (not the module) is cached so two callers
 * on a cold page share one initialisation; a rejected promise is dropped so a transient failure
 * can be retried.
 *
 * `wasmPaths` still points at our directory even though the binary is supplied directly: ORT
 * loads its Emscripten glue (`ort-wasm-simd-threaded.mjs`, 24 KB) from that prefix, and without
 * it that import resolves against the bundler's chunk URL.
 */
export async function loadOnnxRuntime(onProgress?: (p: ModelProgress) => void): Promise<OrtModule> {
  if (runtime) return runtime;
  runtime = (async () => {
    const ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.wasmPaths = ASSET_BASE;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmBinary = await fetchCachedBytes(WASM_URL, 'engine', onProgress);
    return ort;
  })();
  runtime.catch(() => {
    runtime = null;
  });
  return runtime;
}

/**
 * Fetch a large asset, reporting progress, and remember the bytes in the Cache API.
 *
 * Read to completion and stored as a fresh Response rather than caching the live one: teeing a
 * body between the cache and the progress reader buffers the slower consumer, and a synthetic
 * Response of bytes we already hold has no such failure mode.
 *
 * Cache Storage is unavailable in insecure contexts and in some private browsing modes. That is
 * a slow tool, not a broken one, so every cache operation degrades to a plain fetch.
 */
async function fetchCachedBytes(
  url: string,
  file: ModelProgress['file'],
  onProgress?: (p: ModelProgress) => void,
) {
  const cache = await openModelCache();
  const cached = await cache?.match(url).catch(() => undefined);
  const response = cached ?? (await fetch(url).catch(() => null));

  if (!response || !response.ok) {
    throw new OnnxEngineError(
      `The background-removal ${file} could not be downloaded. This is a problem on our side, not with your image.`,
    );
  }

  const total = Number(response.headers.get('content-length') ?? 0);
  const bytes = await readWithProgress(response, total, (p) => onProgress?.({ ...p, file }));

  if (!cached && cache) {
    // Best effort: a full quota, or a browser that refuses to store 4 MB, costs a re-download
    // next time and nothing else.
    await cache
      .put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }))
      .catch(() => undefined);
  }
  return bytes;
}

async function openModelCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  return caches.open(MODEL_CACHE_NAME).catch(() => null);
}

async function readWithProgress(
  response: Response,
  total: number,
  onProgress: (p: { loaded: number; total: number }) => void,
): Promise<Uint8Array> {
  const body = response.body;
  if (!body) return new Uint8Array(await response.arrayBuffer());

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    // Content-Length is the COMPRESSED length when the server encodes the response, so `loaded`
    // can overshoot it. Report the larger of the two as the total rather than showing 140%.
    onProgress({ loaded, total: Math.max(total, loaded) });
  }

  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const sessions = new Map<string, Promise<InferenceSession>>();

/**
 * Build (or reuse) an inference session for a model URL.
 *
 * Sessions are cached for the life of the page: creating one compiles the graph, which for
 * u2netp costs about as much as an inference. Callers get the same session for the same URL, so
 * a second run on the same page pays neither the download nor the compile.
 *
 * The engine is loaded before the weights, so `onProgress` reports `engine` first and `model`
 * second — the order the user sees them arrive.
 */
export async function loadOnnxSession(
  modelUrl: string,
  onProgress?: (p: ModelProgress) => void,
): Promise<InferenceSession> {
  const existing = sessions.get(modelUrl);
  if (existing) return existing;

  const created = (async () => {
    const ort = await loadOnnxRuntime(onProgress);
    const bytes = await fetchCachedBytes(modelUrl, 'model', onProgress);
    try {
      return await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new OnnxEngineError(`The model engine failed to start (${msg}).`);
    }
  })();

  sessions.set(modelUrl, created);
  created.catch(() => sessions.delete(modelUrl));
  return created;
}
