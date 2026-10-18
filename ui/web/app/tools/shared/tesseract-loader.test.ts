/**
 * Stop, and what it has to be able to interrupt.
 *
 * Terminating the worker only ends the job that is inside tesseract at that instant. An OCR loop
 * spends much of its time elsewhere — rendering a PDF page, decoding an image, between pages —
 * and a Stop landing there used to reject nothing at all: the next iteration called `recognize`,
 * which found an empty pool and spawned a NEW worker, and the run finished as if Stop had never
 * been pressed. Worse, the UI had already re-enabled its button, so a second press started a
 * second loop alongside the first.
 *
 * These tests pin the run token that closes that window. tesseract.js is mocked, so `createWorker`
 * being called at all is observable — that call is the bug.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted: vi.mock factories are lifted above the imports, so the spy has to be too.
const { createWorker } = vi.hoisted(() => ({ createWorker: vi.fn() }));
vi.mock('tesseract.js', () => ({
  createWorker,
  OEM: { LSTM_ONLY: 1 },
}));

import {
  OcrCancelledError,
  type OcrRun,
  beginOcrRun,
  ensureRunLive,
  isRunStopped,
  recognize,
  terminateOcr,
} from './tesseract-loader';

/** A worker that reports one progress message, then returns a fixed page. */
function fakeWorker() {
  return {
    recognize: vi.fn(async () => ({
      data: { text: 'hello', confidence: 91, blocks: [] },
    })),
    terminate: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  createWorker.mockReset();
  createWorker.mockImplementation(async () => fakeWorker());
});

afterEach(async () => {
  await terminateOcr();
});

describe('beginOcrRun', () => {
  it('starts live', () => {
    const run = beginOcrRun();
    expect(isRunStopped(run)).toBe(false);
    expect(() => ensureRunLive(run)).not.toThrow();
  });

  it('is stopped by terminateOcr, which is what Stop calls', async () => {
    const run = beginOcrRun();
    await terminateOcr();
    expect(isRunStopped(run)).toBe(true);
    expect(() => ensureRunLive(run)).toThrow(OcrCancelledError);
  });

  it('does not carry the stop over to the next run', async () => {
    const stopped = beginOcrRun();
    await terminateOcr();
    const fresh = beginOcrRun();
    expect(isRunStopped(stopped)).toBe(true);
    expect(isRunStopped(fresh)).toBe(false);
  });
});

describe('recognize', () => {
  const canvas = { width: 100, height: 200 } as HTMLCanvasElement;

  it('runs a page for a live run', async () => {
    const result = await recognize(beginOcrRun(), 'eng', canvas);
    expect(result.text).toBe('hello');
    expect(result.confidence).toBe(91);
    expect(result.width).toBe(100);
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it('refuses a stopped run WITHOUT spawning a worker', async () => {
    const run = beginOcrRun();
    await terminateOcr();

    await expect(recognize(run, 'eng', canvas)).rejects.toBeInstanceOf(OcrCancelledError);
    // The whole point: a Stop between pages must not be answered with a fresh 3.8 MB worker.
    expect(createWorker).not.toHaveBeenCalled();
  });

  it('keeps refusing every later page of a stopped run', async () => {
    const run = beginOcrRun();
    await recognize(run, 'eng', canvas);
    await terminateOcr();

    for (let page = 0; page < 3; page += 1) {
      await expect(recognize(run, 'eng', canvas)).rejects.toBeInstanceOf(OcrCancelledError);
    }
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it('reuses the resident worker across the pages of one run', async () => {
    const run = beginOcrRun();
    await recognize(run, 'eng', canvas);
    await recognize(run, 'eng', canvas);
    await recognize(run, 'eng', canvas);
    expect(createWorker).toHaveBeenCalledTimes(1);
  });

  it('keeps one language resident, not one per language tried', async () => {
    const workers: ReturnType<typeof fakeWorker>[] = [];
    createWorker.mockImplementation(async () => {
      const w = fakeWorker();
      workers.push(w);
      return w;
    });

    const run = beginOcrRun();
    await recognize(run, 'eng', canvas);
    await recognize(run, 'vie', canvas);
    await recognize(run, 'spa', canvas);

    expect(createWorker).toHaveBeenCalledTimes(3);
    // Each switch releases the previous one; only the newest is still alive.
    expect(workers.map((w) => w.terminate.mock.calls.length)).toEqual([1, 1, 0]);
  });

  it('does not let a spawn abandoned by Stop evict the worker that replaced it', async () => {
    const abandonedWorker = fakeWorker();
    let arrive: (w: ReturnType<typeof fakeWorker>) => void = () => {};
    createWorker
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            arrive = resolve;
          }),
      )
      .mockImplementation(async () => fakeWorker());

    const stopped = beginOcrRun();
    const abandoned = recognize(stopped, 'eng', canvas);
    // Wait for the spawn to actually start: tesseract.js is imported dynamically, so without
    // this the second recognize below could be the one handed the never-resolving worker.
    await vi.waitFor(() => expect(createWorker).toHaveBeenCalledTimes(1));
    await terminateOcr(); // Stop, while the first worker is still compiling its WASM.

    const fresh = beginOcrRun();
    await recognize(fresh, 'eng', canvas); // Spawns the second worker, which stays resident.

    arrive(abandonedWorker); // The abandoned spawn finally finishes and rejects itself.
    await expect(abandoned).rejects.toBeInstanceOf(OcrCancelledError);
    expect(abandonedWorker.terminate).toHaveBeenCalledTimes(1);

    await recognize(fresh, 'eng', canvas);
    // Unguarded, that late rejection deleted the SECOND worker's pool entry — leaving it alive
    // and unreachable — and this line spawned a third.
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it('sends progress to the run that owns the job, not to whoever registered last', async () => {
    const first: string[] = [];
    const second: string[] = [];
    let log: ((m: { status: string; progress: number }) => void) | undefined;
    createWorker.mockImplementation(async (_lang: string, _oem: number, options: unknown) => {
      log = (options as { logger: (m: { status: string; progress: number }) => void }).logger;
      return fakeWorker();
    });

    const runA = beginOcrRun();
    await recognize(runA, 'eng', canvas, (p) => first.push(p.status));
    const runB = beginOcrRun();
    await recognize(runB, 'eng', canvas, (p) => second.push(p.status));

    // Both runs have finished; a late message from the worker belongs to neither.
    log?.({ status: 'recognizing text', progress: 0.5 });
    expect(first).toEqual([]);
    expect(second).toEqual([]);
  });

  it('reports progress while its own job is in flight', async () => {
    const seen: number[] = [];
    createWorker.mockImplementation(async (_lang: string, _oem: number, options: unknown) => {
      const { logger } = options as { logger: (m: { status: string; progress: number }) => void };
      const worker = fakeWorker();
      worker.recognize = vi.fn(async () => {
        logger({ status: 'recognizing text', progress: 0.5 });
        return { data: { text: 'hello', confidence: 91, blocks: [] } };
      });
      return worker;
    });

    const run: OcrRun = beginOcrRun();
    await recognize(run, 'eng', canvas, (p) => seen.push(p.progress));
    expect(seen).toEqual([0.5]);
  });
});
