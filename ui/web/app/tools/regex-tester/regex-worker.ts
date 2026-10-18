import { type RegexJob, type RegexJobResult, runRegexJob } from './regex-job';

/**
 * Run a job off the main thread, with a hard stop.
 *
 * The main-thread guard in runRegexJob only fires BETWEEN matches; a single `exec` that
 * backtracks catastrophically never returns to check the clock, and the tab freezes. A worker
 * can be `terminate()`d mid-exec, which is the only real cure. The worker is built from the job
 * function's own source through a blob: URL, so no bundler configuration is involved and the
 * page's CSP (`worker-src 'self' blob:`) already allows it.
 */
export const REGEX_TIMEOUT_MS = 1000;

export const TIMEOUT_ERROR =
  'Regex execution exceeded 1s — possible catastrophic backtracking. Simplify pattern.';

let workerUrl: string | null = null;

function scriptUrl(): string {
  if (workerUrl) return workerUrl;
  const source = `const run = ${runRegexJob.toString()};\nself.onmessage = (e) => { self.postMessage(run(e.data)); };`;
  workerUrl = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }));
  return workerUrl;
}

export function runRegexInWorker(
  job: RegexJob,
  timeoutMs = REGEX_TIMEOUT_MS,
): Promise<RegexJobResult> {
  if (typeof Worker === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return Promise.resolve(runRegexJob(job));
  }
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(scriptUrl());
    } catch {
      resolve(runRegexJob(job));
      return;
    }
    const timer = setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, error: TIMEOUT_ERROR, code: 'timeout' });
    }, timeoutMs);
    worker.onmessage = (e: MessageEvent<RegexJobResult>) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      resolve(runRegexJob(job));
    };
    // The worker checks the clock between matches too; the terminate above is for the exec
    // that never comes back.
    worker.postMessage({ ...job, timeoutMs });
  });
}
