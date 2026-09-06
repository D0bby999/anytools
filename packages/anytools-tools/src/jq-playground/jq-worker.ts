/**
 * Runs INSIDE a dedicated Worker (built by webpack from this file via `new Worker(new URL(...))`
 * in jq-worker-client.ts — a real bundled chunk, not a blob of serialized source like
 * regex-tester's, because jq-wasm is a real npm package with a real WASM binary that a
 * `Function.prototype.toString()` trick cannot carry).
 *
 * WHY THIS NEEDS TO BE A WORKER AT ALL: `Jq.raw()` is synchronous native (WASM) code once the
 * module is loaded — a filter that recurses forever (`def f: f; f`) never returns to JavaScript
 * to let anything check a clock, so the only way to stop it without freezing the tab is to
 * terminate() the whole Worker. jq-worker-client.ts does that after JQ_TIMEOUT_MS.
 */
import { JQ_WASM_URL, runJqDirect } from './logic';

export type JqWorkerRequest = { input: string; query: string };

self.onmessage = async (e: MessageEvent<JqWorkerRequest>) => {
  const { input, query } = e.data;
  const result = await runJqDirect(input, query, JQ_WASM_URL);
  postMessage(result);
};
