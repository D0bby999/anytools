/**
 * python.worker.ts
 * Python for a code exercise, in its own thread (plans/261020-1535-beyond-
 * english-learning-areas, phase 4): Pyodide (MPL-2.0, unmodified, staged
 * under /tool-runtime/), so a loop that never ends can be stopped by ending
 * this worker, and the page never freezes.
 *
 * The first message loads Python. Its three big files are fetched here first
 * so the page can show progress in megabytes; they are served with a
 * year-long cache, so Pyodide's own fetches that follow are read from it.
 *
 * Then the worker is cut off before any exercise runs (lockDown). An
 * exercise may have been written by the learner's model from a document they
 * did not write, and this worker shares the app's origin: without the cut,
 * its tests could reach `js.fetch` and call the app's routes with the
 * learner's session, or rewrite the offline cache. Python needs none of it:
 * the standard library is already in memory.
 */
/// <reference lib="webworker" />
// Relative, not "~/": a worker is bundled on its own, without the app's alias.
import { HARNESS, type RunResult } from "../lib/python-harness";

const BASE = "/tool-runtime/pyodide@314.0.7/";
const BIG = ["pyodide.asm.wasm", "python_stdlib.zip", "pyodide.asm.mjs"];

type Request = { id: number; code: string; tests: string; module: string };
export type WorkerMessage =
  | { kind: "progress"; loaded: number; total: number }
  | { kind: "ready" }
  | { kind: "result"; id: number; result: RunResult }
  | { kind: "failed"; id: number; message: string };

const post = (m: WorkerMessage) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

type Pyodide = { runPython: (code: string) => unknown; globals: { get: (name: string) => unknown } };
let python: Promise<Pyodide> | null = null;

async function prefetch() {
  const sizes = await Promise.all(
    // The file's own size: Content-Length is the compressed size, or absent,
    // while the reader below counts the bytes after decompression.
    BIG.map((f) =>
      fetch(BASE + f, { method: "HEAD" })
        .then((r) => Number(r.headers.get("X-File-Size") ?? r.headers.get("Content-Length") ?? 0))
        .catch(() => 0),
    ),
  );
  const total = sizes.reduce((a, b) => a + b, 0);
  let loaded = 0;
  await Promise.all(
    BIG.map(async (f) => {
      const res = await fetch(BASE + f);
      const reader = res.body?.getReader();
      if (!reader) return;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        loaded += value.byteLength;
        post({ kind: "progress", loaded, total });
      }
    }),
  );
}

/** What reaches the network, storage or other contexts from a worker. */
const CUT = [
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "WebTransport",
  "EventSource",
  "importScripts",
  "caches",
  "indexedDB",
  "BroadcastChannel",
  "Worker",
  "SharedWorker",
  "Request",
  "Response",
] as const;

/**
 * Removes them from this worker's global and from every prototype behind it,
 * so Python (through `js`) cannot reach them: `fetch` is also a method of
 * WorkerGlobalScope.prototype, and `caches` and `indexedDB` are getters there,
 * which an own property only hides (a getter can be called on the global).
 */
export function lockDown(scope: object = self) {
  for (let level: object | null = scope; level; level = Object.getPrototypeOf(level)) {
    for (const name of CUT) {
      if (!Object.prototype.hasOwnProperty.call(level, name)) continue;
      // A property the browser will not delete is replaced instead.
      if (!Reflect.deleteProperty(level, name)) {
        Reflect.defineProperty(level, name, { value: undefined, writable: false, configurable: false });
      }
    }
  }
  for (const name of CUT) Reflect.defineProperty(scope, name, { value: undefined, writable: false, configurable: false });
}

function load(): Promise<Pyodide> {
  python ??= (async () => {
    await prefetch();
    const { loadPyodide } = (await import(/* @vite-ignore */ `${BASE}pyodide.mjs`)) as {
      loadPyodide: (o: { indexURL: string }) => Promise<Pyodide>;
    };
    const py = await loadPyodide({ indexURL: BASE });
    py.runPython(HARNESS);
    lockDown();
    post({ kind: "ready" });
    return py;
  })();
  return python;
}

self.onmessage = async (e: MessageEvent<Request | { warm: true }>) => {
  if ("warm" in e.data) {
    void load().catch(() => undefined);
    return;
  }
  const { id, code, tests, module } = e.data;
  try {
    const py = await load();
    const run = py.globals.get("anylearn_run") as (c: string, t: string, m: string) => { toJs: (o: object) => unknown; destroy: () => void };
    const proxy = run(code, tests, module);
    const result = proxy.toJs({ dict_converter: Object.fromEntries }) as RunResult;
    proxy.destroy();
    post({ kind: "result", id, result });
  } catch (err) {
    python = null;
    post({ kind: "failed", id, message: err instanceof Error ? err.message : String(err) });
  }
};
