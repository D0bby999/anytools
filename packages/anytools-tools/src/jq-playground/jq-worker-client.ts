import type { JqWorkerRequest } from './jq-worker';
/**
 * Main-thread side of jq-worker.ts: spawn it, give it JQ_TIMEOUT_MS, terminate() on timeout or
 * error. A fresh Worker per run (not a reused one) — same trade-off regex-tester made: the
 * WASM binary is re-fetched, but the Service Worker's vendor cache and the browser's own WASM
 * compilation cache make that cheap after the first run, and "just terminate it" is far simpler
 * and safer than trying to recover a Worker that may be mid-infinite-loop.
 */
import { JQ_TIMEOUT_MS, type JqRunOutcome, runJqOnMainThread } from './logic';

export const JQ_TIMEOUT_ERROR_CODE = 'timeout' as const;

function timeoutOutcome(timeoutMs: number): JqRunOutcome {
  return {
    ok: false,
    code: 'timeout',
    error: `jq filter exceeded ${Math.round(timeoutMs / 1000)}s — likely an infinite recursive filter (e.g. "def f: f; f"). Simplify it and try again.`,
  };
}

export function runJqInWorker(
  input: string,
  query: string,
  timeoutMs = JQ_TIMEOUT_MS,
): Promise<JqRunOutcome> {
  if (typeof Worker === 'undefined') {
    return runJqOnMainThread(input, query);
  }
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./jq-worker.ts', import.meta.url));
    } catch {
      resolve(runJqOnMainThread(input, query));
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      resolve(timeoutOutcome(timeoutMs));
    }, timeoutMs);
    worker.onmessage = (e: MessageEvent<JqRunOutcome>) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      resolve(runJqOnMainThread(input, query));
    };
    const request: JqWorkerRequest = { input, query };
    worker.postMessage(request);
  });
}
