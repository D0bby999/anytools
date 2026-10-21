/**
 * python-runner.ts
 * The page's side of the Python worker (workers/python.worker.ts): one
 * worker for the page, a run at a time, Stop that ends the worker (the next
 * run starts a fresh one, Python then read from the browser's cache), and a
 * hard stop at thirty seconds.
 */
import type { RunResult } from "~/lib/python-harness";
import type { WorkerMessage } from "~/workers/python.worker";

export const HARD_STOP_MS = 30_000;

export type RunOutcome =
  | { kind: "result"; result: RunResult }
  | { kind: "stopped"; byTimeout: boolean }
  | { kind: "failed"; message: string };

type Listener = (loaded: number, total: number) => void;

let worker: Worker | null = null;
let ready = false;
let nextId = 1;
let pending: { id: number; resolve: (o: RunOutcome) => void; timer: ReturnType<typeof setTimeout> } | null = null;
const listeners = new Set<Listener>();

function spawn(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/python.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const m = e.data;
    if (m.kind === "progress") listeners.forEach((l) => l(m.loaded, m.total));
    else if (m.kind === "ready") ready = true;
    else if (pending && m.id === pending.id) {
      clearTimeout(pending.timer);
      const done = pending.resolve;
      pending = null;
      if (m.kind === "result") done({ kind: "result", result: m.result });
      else {
        // A run that threw (Python itself out of memory, a stack overflow)
        // leaves the worker unable to load Python again: its fetch is cut
        // off. The next run gets a new worker.
        end();
        done({ kind: "failed", message: m.message });
      }
    }
  };
  worker.onerror = () => {
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve({ kind: "failed", message: "worker" });
      pending = null;
    }
    end();
  };
  return worker;
}

function end() {
  worker?.terminate();
  worker = null;
  ready = false;
}

/** Starts loading Python before the first run (on opening an exercise). */
export function warmPython() {
  spawn().postMessage({ warm: true });
}

/** Whether Python has loaded in the current worker. */
export function pythonReady() {
  return ready;
}

/** Download progress, in bytes, while Python loads. */
export function onPythonProgress(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Runs code against tests; one run at a time. */
export function runPython(code: string, tests: string, module: string): Promise<RunOutcome> {
  stopPython();
  const w = spawn();
  const id = nextId++;
  return new Promise((resolve) => {
    // The clock starts once Python is loaded: a slow download is not a loop.
    const arm = (): ReturnType<typeof setTimeout> =>
      setTimeout(() => {
        if (!ready) {
          if (pending?.id === id) pending.timer = arm();
          return;
        }
        if (pending?.id !== id) return;
        pending = null;
        end();
        resolve({ kind: "stopped", byTimeout: true });
      }, HARD_STOP_MS);
    pending = { id, resolve, timer: arm() };
    w.postMessage({ id, code, tests, module });
  });
}

/** Ends a run in progress by ending the worker. */
export function stopPython() {
  if (!pending) return;
  clearTimeout(pending.timer);
  const done = pending.resolve;
  pending = null;
  end();
  done({ kind: "stopped", byTimeout: false });
}
