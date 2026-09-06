/**
 * jq execution, decoupled from where the WASM binary comes from.
 *
 * `runJqDirect`'s `wasmUrl` parameter is the whole trick that keeps this file testable with the
 * REAL jq-wasm library instead of a mock: leaving it `undefined` lets jq-wasm fall back to its
 * own platform default, which under Node is a plain `fs.readFileSync` of the binary next to the
 * package — so `logic.test.ts` runs actual jq queries, in Node, with no browser and no fetch.
 * Every real BROWSER call site (jq-worker.ts, and the main-thread fallback below) passes
 * `JQ_WASM_URL` explicitly, because jq-wasm's own browser default is `new URL('./build/jq.wasm',
 * import.meta.url)` relative to ITS module — exactly the kind of implicit, unpinned path this
 * site's `vendor-assets.test.ts` exists to catch. Passing a bare path string to `wasmURL` in Node
 * breaks (`fetch()` on undici needs an absolute URL) — that's WHY the two paths cannot share one
 * hardcoded constant, only this one function with a parameter.
 */
import type { Jq } from 'jq-wasm';
import { ToolError } from '../shared/tool-error';

/** Where copy-vendor-assets.mjs stages jq-wasm's binary. */
export const JQ_WASM_URL = '/third-party/jq/jq.wasm';

/** Wall-clock budget for one run in the Worker before it is terminate()d. */
export const JQ_TIMEOUT_MS = 8000;

/** jq-wasm loads the whole document into memory; this is a sanity ceiling, not a jq limit. */
export const MAX_JQ_INPUT_BYTES = 5 * 1024 * 1024;

export type JqExample = {
  id: string;
  /** Shown on the button — the filter itself, since that's what teaches jq syntax. */
  label: string;
  input: string;
  query: string;
};

// Each one is a complete, runnable lesson: click it, see real input, a real filter, a real
// result. Chosen to cover the operators newcomers ask about most (field access, filtering,
// mapping, grouping, object<->array conversion) — this list, not a text explainer, is the
// tool's actual teaching mechanism.
export const JQ_EXAMPLES: JqExample[] = [
  {
    id: 'field',
    label: '.foo',
    input: '{\n  "foo": { "bar": 42 }\n}',
    query: '.foo.bar',
  },
  {
    id: 'select',
    label: '.[] | select(...)',
    input:
      '[\n  { "name": "Alice", "age": 31 },\n  { "name": "Bob", "age": 19 },\n  { "name": "Cara", "age": 42 }\n]',
    query: '.[] | select(.age > 30)',
  },
  {
    id: 'map',
    label: 'map',
    input: '[1, 2, 3, 4, 5]',
    query: 'map(. * 2)',
  },
  {
    id: 'group_by',
    label: 'group_by',
    input:
      '[\n  { "team": "A", "score": 3 },\n  { "team": "B", "score": 1 },\n  { "team": "A", "score": 5 }\n]',
    query: 'group_by(.team)',
  },
  {
    id: 'to_entries',
    label: 'to_entries',
    input: '{ "a": 1, "b": 2, "c": 3 }',
    query: 'to_entries',
  },
];

export type JqRunOutcome =
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; error: string; code: 'invalidQuery' | 'timeout' | 'unavailable' };

/** Throws when the JSON text is too large to hand to a WASM module that loads it all at once. */
export function validateJqInputSize(input: string): void {
  const bytes = new TextEncoder().encode(input).length;
  if (bytes <= MAX_JQ_INPUT_BYTES) return;
  const mb = Math.round(MAX_JQ_INPUT_BYTES / (1024 * 1024));
  throw new ToolError(
    'inputTooLarge',
    `Input is larger than ${mb} MB. jq-wasm loads the whole document into memory before it can run any filter, so a bigger one risks exhausting the tab. Trim the sample or pre-filter it with a streaming tool first.`,
    { mb },
  );
}

const jqHandles = new Map<string, Promise<Jq>>();

/** One loaded jq handle per distinct `wasmUrl` (at most two: Node's default, and the browser's). */
async function getJq(wasmUrl: string | undefined): Promise<Jq> {
  const key = wasmUrl ?? '';
  let handle = jqHandles.get(key);
  if (!handle) {
    handle = import('jq-wasm').then(({ loadJq }) =>
      loadJq(wasmUrl === undefined ? undefined : { wasmURL: wasmUrl }),
    );
    handle.catch(() => jqHandles.delete(key));
    jqHandles.set(key, handle);
  }
  return handle;
}

/**
 * Run one jq filter against one JSON document and return jq's own stdout/stderr verbatim —
 * never rewritten, per the spec: a bad filter must show jq's real error, not a paraphrase.
 */
export async function runJqDirect(
  input: string,
  query: string,
  wasmUrl?: string,
  // Exposed mainly so logic.test.ts can pass ['-c'] and get one JSON value per line — a stable
  // shape to assert on. The real UI calls with the default (pretty-printed), which is what a
  // playground should show; jq's own indentation is not this file's to reinvent.
  flags: string[] = [],
): Promise<JqRunOutcome> {
  if (query.trim().length === 0) {
    return { ok: false, error: 'Filter is empty', code: 'invalidQuery' };
  }
  let jq: Jq;
  try {
    jq = await getJq(wasmUrl);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'jq engine failed to load',
      code: 'unavailable',
    };
  }
  let result: ReturnType<Jq['raw']>;
  try {
    result = jq.raw(input, query, flags);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), code: 'invalidQuery' };
  }
  if (result.exitCode !== 0) {
    return {
      ok: false,
      error: result.stderr.trim() || `jq exited with status ${result.exitCode}`,
      code: 'invalidQuery',
    };
  }
  return { ok: true, stdout: result.stdout, stderr: result.stderr };
}

/** Same-origin fallback for the rare browser with no Web Worker support — no cancellation. */
export function runJqOnMainThread(input: string, query: string): Promise<JqRunOutcome> {
  return runJqDirect(input, query, JQ_WASM_URL);
}
