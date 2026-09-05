/**
 * Load onnxruntime-web from this origin, and hand tools a cached InferenceSession.
 *
 * Four things this module exists to guarantee:
 *
 *  1. NOTHING IS FETCHED FROM A CDN, AND NOTHING IS FETCHED AT RUNTIME AT ALL. `onnxruntime-web/wasm`
 *     resolves (import condition, no `onnxruntime-web-use-extern-wasm`) to `ort.wasm.bundle.min.mjs`,
 *     the build with the Emscripten glue inlined. Read in 1.29.0's own bundle: the glue is imported
 *     over the network ONLY when `env.wasm.wasmPaths` is set — a STRING wasmPaths makes it
 *     `import()` `<prefix>ort-wasm-simd-threaded.mjs` on every cold page. Leaving wasmPaths unset
 *     takes the branch that returns the inlined glue, and because the binary arrives as
 *     `env.wasm.wasmBinary` the runtime issues ZERO requests of its own. An earlier version set
 *     wasmPaths to our own directory and paid a 24 KB request per cold page for it, which also made
 *     the FAQ's "works offline after the first run" untrue.
 *
 *  2. NO CROSS-ORIGIN ISOLATION IS REQUIRED. ORT's default `numThreads: 0` means "one thread per
 *     core", and threads need SharedArrayBuffer, which needs COOP+COEP headers. This site cannot
 *     send those: COEP breaks the AdSense iframes. So `numThreads = 1` — explicitly, not by
 *     accident — and `proxy = false`, which would otherwise spawn a worker from a blob URL.
 *     Single-threaded WASM is roughly 2× slower than a 4-thread run; that is the price, and it is
 *     paid on purpose. (1.29.0 ships only the `-threaded` binary; single-threading is a runtime
 *     flag, not a different file, so there is no lighter build to switch to.)
 *
 *  3. THE MODEL AND THE RUNTIME ARE DOWNLOADED ONCE — AND THE CACHE IS VERSIONED. ~19 MB per page
 *     load would make the tool unusable on a phone, so both go through the Cache API under
 *     `anytools-models`. Keyed by URL ALONE that cache is a trap: the glue is bundled into our JS
 *     and the binary is a file, so bumping onnxruntime-web would ship a new glue while every
 *     returning visitor still holds the old binary — a `LinkError` on load, permanently, with no
 *     way for the user to guess that "clear site data" is the fix. The key therefore carries a
 *     version: the runtime's is ORT's own version string, the model's is its pinned sha256 (a model
 *     swap is a new hash, so it cannot serve stale weights). Entries for other versions of the same
 *     path are deleted the first time we look for the current one.
 *
 *  4. THE INTEGRITY CLAIM IS REAL. The model's sha256 is pinned in vendor-assets.json and checked
 *     at build time; here it is checked again on the bytes the browser actually received, before
 *     they are cached. Hashing 4.4 MB costs a few milliseconds once.
 *
 * The `import()` is dynamic and lives inside the function: importing this module must not pull
 * ORT into any page's initial chunk.
 */
import type { InferenceSession } from 'onnxruntime-web';
import { ToolError } from './tool-error';

/** Where copy-vendor-assets.mjs stages the runtime. */
const ASSET_BASE = '/third-party/onnx/';

/** The 14 MB binary. Fetched by us, not by ORT, so that it lands in the Cache API. */
const WASM_URL = `${ASSET_BASE}ort-wasm-simd-threaded.wasm`;

/**
 * Cache-key version for the runtime when ORT stops reporting its own.
 * Bump this together with the `onnxruntime-web` pin in package.json.
 */
const ENGINE_VERSION_FALLBACK = '1.29.0';

/** Cache Storage bucket for model weights. Shared by every model-backed tool. */
export const MODEL_CACHE_NAME = 'anytools-models';

export class OnnxEngineError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'OnnxEngineError';
  }
}

/**
 * Which file is downloading, plus bytes so far / total from Content-Length. `total` is 0 when
 * the server did not say, or when the bytes came from the cache in one piece.
 */
export type ModelProgress = { file: 'engine' | 'model'; loaded: number; total: number };

/** A weights file: where it is served from, and what it must hash to. */
export type OnnxModel = { url: string; sha256: string };

type OrtModule = typeof import('onnxruntime-web/wasm');

/** True for the DOMException a fetch raises when its AbortSignal fires. */
export function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

/** Cache Storage key for `url` pinned to `version`. */
export function cacheKeyFor(url: string, version: string): string {
  return `${url}?v=${encodeURIComponent(version)}`;
}

/**
 * Is this cached entry a copy of `url` from some version other than `version`?
 *
 * Cache Storage stores absolute request URLs, so the comparison is by path suffix. An entry with
 * no query at all is a pre-versioning one and counts as stale — that is the migration path for
 * anyone who used the tool before this key scheme existed.
 */
export function isStaleCacheEntry(cachedUrl: string, url: string, version: string): boolean {
  const cut = cachedUrl.indexOf('?');
  const path = cut === -1 ? cachedUrl : cachedUrl.slice(0, cut);
  if (!path.endsWith(url)) return false;
  return (cut === -1 ? '' : cachedUrl.slice(cut)) !== `?v=${encodeURIComponent(version)}`;
}

/** Lower-case hex, the form sha256 digests are quoted in everywhere else in this repo. */
export function toHex(digest: ArrayBuffer): string {
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

let runtime: Promise<OrtModule> | null = null;

/**
 * Import the wasm-only build and configure it before anything can trigger a fetch.
 *
 * `onnxruntime-web/wasm` rather than the default entry: the default also carries the WebGL
 * backend, which this site never selects. The promise (not the module) is cached so two callers
 * on a cold page share one initialisation; a rejected promise is dropped so a transient failure —
 * or a cancelled download — can be retried.
 */
export async function loadOnnxRuntime(
  onProgress?: (p: ModelProgress) => void,
  signal?: AbortSignal,
): Promise<OrtModule> {
  if (runtime) return runtime;
  runtime = (async () => {
    const ort = await import('onnxruntime-web/wasm');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const version = ort.env.versions.web ?? ort.env.versions.common ?? ENGINE_VERSION_FALLBACK;
    ort.env.wasm.wasmBinary = await fetchCachedBytes(
      WASM_URL,
      version,
      'engine',
      onProgress,
      signal,
    );
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
 * `expectSha256` is checked on freshly fetched bytes only. A cached entry was verified when it was
 * written and its key contains that very hash, so re-hashing it on every page load would buy
 * nothing.
 *
 * Cache Storage is unavailable in insecure contexts and in some private browsing modes. That is
 * a slow tool, not a broken one, so every cache operation degrades to a plain fetch.
 */
async function fetchCachedBytes(
  url: string,
  version: string,
  file: ModelProgress['file'],
  onProgress?: (p: ModelProgress) => void,
  signal?: AbortSignal,
  expectSha256?: string,
): Promise<Uint8Array> {
  const cache = await openModelCache();
  const key = cacheKeyFor(url, version);
  if (cache) await purgeOtherVersions(cache, url, version);

  const cached = await cache?.match(key).catch(() => undefined);
  const response = cached ?? (await fetchOrNull(url, signal));

  if (!response || !response.ok) {
    // One code per file ("engineDownloadFailed" / "modelDownloadFailed"): the file is named in
    // prose, and a translated sentence cannot splice an English noun into itself.
    throw new OnnxEngineError(
      `${file}DownloadFailed`,
      `The background-removal ${file} could not be downloaded. This is a bug on our side, not a problem with your image.`,
      { file },
    );
  }

  const total = Number(response.headers.get('content-length') ?? 0);
  const bytes = await readWithProgress(response, total, signal, (p) =>
    onProgress?.({ ...p, file }),
  );

  if (!cached) {
    if (expectSha256) {
      const actual = await sha256Hex(bytes);
      if (actual && actual !== expectSha256) {
        const got = actual.slice(0, 12);
        const want = expectSha256.slice(0, 12);
        throw new OnnxEngineError(
          `${file}Corrupted`,
          `The background-removal ${file} arrived corrupted (checksum ${got}…, expected ${want}…). This is a bug on our side, not a problem with your image.`,
          { file, actual: got, expected: want },
        );
      }
    }
    // Best effort: a full quota, or a browser that refuses to store 4 MB, costs a re-download
    // next time and nothing else.
    await cache
      ?.put(key, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }))
      .catch(() => undefined);
  }
  return bytes;
}

async function fetchOrNull(url: string, signal?: AbortSignal): Promise<Response | null> {
  try {
    return await fetch(url, { signal });
  } catch (e) {
    // A cancelled download is the user's decision, not a failure to report as one.
    if (isAbortError(e)) throw e;
    return null;
  }
}

/** Drop every copy of `url` cached under a different version. Cheap: the bucket holds a handful. */
async function purgeOtherVersions(cache: Cache, url: string, version: string): Promise<void> {
  const keys = await cache.keys().catch(() => [] as readonly Request[]);
  await Promise.all(
    keys
      .filter((r) => isStaleCacheEntry(r.url, url, version))
      .map((r) => cache.delete(r).catch(() => false)),
  );
}

/** Digest, or null where SubtleCrypto is absent (insecure context) and the check cannot run. */
async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
}

async function openModelCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  return caches.open(MODEL_CACHE_NAME).catch(() => null);
}

async function readWithProgress(
  response: Response,
  total: number,
  signal: AbortSignal | undefined,
  onProgress: (p: { loaded: number; total: number }) => void,
): Promise<Uint8Array> {
  const body = response.body;
  if (!body) return new Uint8Array(await response.arrayBuffer());

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    // A cached Response has no in-flight request for the signal to abort, so the loop checks too.
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined);
      throw new DOMException('Download cancelled', 'AbortError');
    }
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
 * Run `step`, and turn anything it throws that is not already ours into one message.
 *
 * A missing binary, a glue/binary mismatch or a failed WASM instantiation otherwise surfaces the
 * browser's own wording — "LinkError: function import requires a callable" — which reads as if the
 * user's file were at fault. Same shape as pdfjs-loader's worker branch.
 */
async function withEngineError<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (e) {
    if (e instanceof OnnxEngineError || isAbortError(e)) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new OnnxEngineError(
      'engineStartFailed',
      `The background-removal engine failed to start (${msg}). This is a bug on our side, not a problem with your image.`,
      { detail: msg },
    );
  }
}

/**
 * Build (or reuse) an inference session for a model.
 *
 * Sessions are cached for the life of the page: creating one compiles the graph, which for
 * u2netp costs about as much as an inference. Callers get the same session for the same URL, so
 * a second run on the same page pays neither the download nor the compile.
 *
 * The engine is loaded before the weights, so `onProgress` reports `engine` first and `model`
 * second — the order the user sees them arrive.
 */
export async function loadOnnxSession(
  model: OnnxModel,
  onProgress?: (p: ModelProgress) => void,
  signal?: AbortSignal,
): Promise<InferenceSession> {
  const existing = sessions.get(model.url);
  if (existing) return existing;

  const created = (async () => {
    const ort = await withEngineError(() => loadOnnxRuntime(onProgress, signal));
    // The model's version IS its content hash: new weights, new key, no chance of stale bytes.
    const bytes = await fetchCachedBytes(
      model.url,
      model.sha256,
      'model',
      onProgress,
      signal,
      model.sha256,
    );
    return withEngineError(() =>
      ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }),
    );
  })();

  sessions.set(model.url, created);
  created.catch(() => sessions.delete(model.url));
  return created;
}
