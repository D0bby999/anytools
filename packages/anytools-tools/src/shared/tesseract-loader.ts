/**
 * Load tesseract.js and run OCR entirely from this origin.
 *
 * THE POINT OF THIS FILE. Out of the box tesseract.js fetches three separate things from two
 * public CDNs at the moment you press the button: `worker.min.js` and the WASM core from
 * jsDelivr, and each `*.traineddata` from jsDelivr's copy of the tessdata releases. That would
 * tell a third party which document a visitor is reading, on a site whose entire premise is that
 * nothing leaves the device. All three are staged into public/third-party/ by
 * scripts/copy-vendor-assets.mjs (manifest keys `tesseract` and `tessdata`) and pointed at
 * explicitly below. apps/anytools-web/src/lib/vendor-assets.test.ts fails if a CDN string ever
 * reappears in src/.
 *
 * WHY corePath NAMES A FILE AND NOT A DIRECTORY. The documented advice is to hand `corePath` a
 * directory and let tesseract.js pick the variant the device supports. In v7 that picker asks
 * for `tesseract-core-relaxedsimd-lstm.wasm.js` first (see its worker-script/browser/getCore.js),
 * and the manifest stages only the plain-SIMD and no-SIMD LSTM builds — each ~3.8 MB, and
 * carrying a third for a marginal speed gain is not worth the image size. Directory mode would
 * therefore 404 on any current Chrome. So the detection happens here instead, on the same
 * WebAssembly.validate probe wasm-feature-detect uses, and `corePath` names the exact file.
 *
 * WHY THE LANGUAGE LIST IS FOUR ENTRIES. `langPath` only resolves what has been staged. Adding a
 * fifth language means adding its traineddata to the manifest with a pinned sha256, not adding a
 * string here — otherwise the option appears in the UI and 404s when chosen.
 */

import type { Word as TesseractWord, Worker as TesseractWorker } from 'tesseract.js';
import { fitWithin } from './canvas-image';
import { ToolError } from './tool-error';

/** Exactly the traineddata files staged under public/third-party/tessdata/. */
export const OCR_LANGUAGES = ['eng', 'vie', 'spa', 'por'] as const;
export type OcrLanguage = (typeof OCR_LANGUAGES)[number];

export const OCR_LANGUAGE_LABELS: Record<OcrLanguage, string> = {
  eng: 'English',
  vie: 'Vietnamese',
  spa: 'Spanish',
  por: 'Portuguese',
};

const WORKER_PATH = '/third-party/tesseract/worker.min.js';
const CORE_DIR = '/third-party/tesseract/';
const LANG_PATH = '/third-party/tessdata/';

/**
 * Tesseract slows down superlinearly with page size and gains nothing above roughly 300 DPI on
 * A4. Anything larger is downscaled before recognition; callers that map word boxes back onto a
 * document must use the `width`/`height` reported on the result, not the size they passed in.
 */
export const MAX_OCR_DIMENSION = 3000;

/** Pixel box in the coordinates of the image that was recognised: origin top-left, y downwards. */
export type OcrBox = { x0: number; y0: number; x1: number; y1: number };

export type OcrWord = { text: string; confidence: number; bbox: OcrBox };
export type OcrLine = { text: string; words: OcrWord[] };
export type OcrBlock = { lines: OcrLine[] };

export type OcrResult = {
  /** Tesseract's own layout of the page, newlines included. */
  text: string;
  /** Mean confidence for the page, 0-100. */
  confidence: number;
  blocks: OcrBlock[];
  /** Size of the image actually fed to tesseract, after any downscale. */
  width: number;
  height: number;
};

export type OcrProgress = { status: string; progress: number };

/** Raised when the user presses Stop. Callers should swallow it rather than show an error. */
export class OcrCancelledError extends Error {
  constructor() {
    super('OCR stopped.');
    this.name = 'OcrCancelledError';
  }
}

/**
 * One pass over a batch of pages or images.
 *
 * Stop used to be enforced only on the job that happened to be inside tesseract at that instant.
 * A loop spends a good part of its time elsewhere — rendering a PDF page, decoding an image,
 * between pages — and a Stop landing there rejected nothing, so the next iteration called
 * `recognize`, which spawned a brand new worker and carried the run to completion. A run token
 * closes that window: it records the generation it began in, and every step checks that the
 * module has not been terminated since.
 *
 * It also carries the progress sink, which used to be a single module-level variable shared by
 * whatever was running. Two overlapping loops then reported into each other's progress bar.
 */
export type OcrRun = {
  /** Generation this run began in. `terminateOcr` bumps the module counter past it. */
  readonly startedAt: number;
  /** Where progress for this run's current job goes. Set per `recognize` call. */
  progress: ((p: OcrProgress) => void) | null;
};

/** Start a run. Call once per user-initiated pass, then thread it through every step. */
export function beginOcrRun(): OcrRun {
  return { startedAt: generation, progress: null };
}

/** Has Stop (or an unmount) happened since this run began? */
export function isRunStopped(run: OcrRun): boolean {
  return run.startedAt !== generation;
}

/** Abort a stopped run at a step boundary. The loop's catch treats this as "stopped", not error. */
export function ensureRunLive(run: OcrRun): void {
  if (isRunStopped(run)) throw new OcrCancelledError();
}

export class OcrLoadError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'OcrLoadError';
  }
}

/**
 * Does this device run SIMD WebAssembly? Byte-for-byte the module wasm-feature-detect validates.
 * Cached: the answer cannot change within a page load, and the probe is called per worker.
 */
let simdSupported: boolean | null = null;
function hasSimd(): boolean {
  if (simdSupported === null) {
    simdSupported = WebAssembly.validate(
      // biome-ignore format: a wasm module, not a list of magic numbers to be reflowed
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
    );
  }
  return simdSupported;
}

const corePath = () =>
  `${CORE_DIR}${hasSimd() ? 'tesseract-core-simd-lstm.wasm.js' : 'tesseract-core-lstm.wasm.js'}`;

/**
 * One live worker, kept alive between runs.
 *
 * Spawning is expensive: ~3.8 MB of WASM to compile plus 0.5-4 MB of traineddata to parse. A
 * user OCRing ten images pays that once. Only ONE language stays resident: this used to be a
 * pool keyed by language that was never trimmed, so a visitor trying their document in each of
 * the four staged languages left four compiled cores and four language models pinned in the tab
 * until they navigated away. Switching language releases the previous worker instead, which
 * costs one respawn on a switch — rare, and bounded memory is worth more than that.
 *
 * `generation` is the Stop counter: a worker still loading when the user presses Stop is
 * terminated on arrival instead of joining the pool as a zombie, and a run that was stopped
 * between pages cannot start a fresh one on its next page (see `OcrRun`).
 *
 * CACHE KEY. `cacheMethod: 'write'` stores the traineddata in IndexedDB under the bare language
 * name — "eng" — with nothing recording which model set it came from. Everything staged here is
 * `tessdata_fast`, so the key is unambiguous today. If `tessdata_best` is ever offered as a
 * second choice, the two would collide in that cache and whichever ran first would silently win;
 * that change needs a distinct `cachePath` per set, not just a different `langPath`.
 */
const workers = new Map<OcrLanguage, Promise<TesseractWorker>>();
const live = new Set<TesseractWorker>();
let generation = 0;

/** The run whose job the worker is executing, so its logger reports into the right progress bar. */
let activeRun: OcrRun | null = null;

/** Terminate every resident worker except `keep`. Does NOT bump the generation: no run is cancelled. */
async function releaseOtherLanguages(keep: OcrLanguage): Promise<void> {
  const stale = [...workers.entries()].filter(([lang]) => lang !== keep);
  for (const [lang] of stale) workers.delete(lang);
  await Promise.all(
    stale.map(async ([, pending]) => {
      try {
        const worker = await pending;
        live.delete(worker);
        await worker.terminate();
      } catch {
        // Never finished spawning, or already terminated. Nothing to release either way.
      }
    }),
  );
}

async function getWorker(lang: OcrLanguage): Promise<TesseractWorker> {
  const existing = workers.get(lang);
  if (existing) return existing;
  await releaseOtherLanguages(lang);

  const spawnedAt = generation;
  const promise = (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    const worker = await createWorker(lang, OEM.LSTM_ONLY, {
      workerPath: WORKER_PATH,
      corePath: corePath(),
      langPath: LANG_PATH,
      // The staged files are plain .traineddata, not .traineddata.gz. Left at its default of
      // true, tesseract.js requests "<lang>.traineddata.gz" and every language 404s.
      gzip: false,
      // 'write' keeps the traineddata in IndexedDB, so the second run of a language costs no
      // download at all. It is the user's own browser storage; the FAQ says so.
      cacheMethod: 'write',
      logger: (m) => activeRun?.progress?.({ status: m.status, progress: m.progress }),
    });
    if (spawnedAt !== generation) {
      // Stop was pressed while this was loading. Nobody is waiting for it any more.
      await worker.terminate();
      throw new OcrCancelledError();
    }
    live.add(worker);
    return worker;
  })();

  workers.set(lang, promise);
  // Identity-guarded: an unguarded delete raced with Stop-during-spawn. Stop clears the map, the
  // next run puts a NEW promise under the same key, then this failing one deletes that entry —
  // and its worker is live, referenced by nothing, never terminated.
  promise.catch(() => {
    if (workers.get(lang) === promise) workers.delete(lang);
  });
  return promise;
}

/** In-flight jobs, so Stop can reject them instead of leaving the caller's loop hanging. */
const inFlight = new Set<(error: unknown) => void>();

/**
 * Recognise one image.
 *
 * `image` may be anything tesseract.js accepts; in practice these tools pass a canvas produced
 * by `prepareForOcr`. Progress is reported for the whole pipeline — core download, traineddata
 * download, then recognition — because the first run of a language spends most of its time
 * before recognition starts and a bar stuck at 0% looks like a hang.
 */
export async function recognize(
  run: OcrRun,
  lang: OcrLanguage,
  image: HTMLCanvasElement | Blob,
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrResult> {
  // Checked here as well as in the caller's loop. Stop can land between the two, and spawning a
  // worker for a run nobody is waiting on is precisely the leak this guards.
  ensureRunLive(run);
  run.progress = onProgress ?? null;
  activeRun = run;

  let cancel: (error: unknown) => void = () => {};
  try {
    const worker = await getWorker(lang).catch((e: unknown) => {
      if (e instanceof OcrCancelledError) throw e;
      throw new OcrLoadError(
        'ocrStartFailed',
        `The ${OCR_LANGUAGE_LABELS[lang]} recogniser could not start. Reload the page and try again.`,
        { lang, langLabel: OCR_LANGUAGE_LABELS[lang] },
      );
    });
    // Loading the core and the language data takes seconds; Stop is often pressed inside it.
    ensureRunLive(run);

    const cancelled = new Promise<never>((_, reject) => {
      cancel = reject;
    });
    inFlight.add(cancel);

    const { data } = await Promise.race([
      worker.recognize(image, {}, { text: true, blocks: true }),
      cancelled,
    ]);
    const width = 'width' in image ? image.width : 0;
    const height = 'height' in image ? image.height : 0;
    return {
      text: data.text ?? '',
      confidence: typeof data.confidence === 'number' ? data.confidence : 0,
      blocks: (data.blocks ?? []).map((block) => ({
        lines: (block.paragraphs ?? []).flatMap((p) =>
          (p.lines ?? []).map((line) => ({
            text: line.text ?? '',
            words: (line.words ?? []).map(toWord),
          })),
        ),
      })),
      width,
      height,
    };
  } finally {
    inFlight.delete(cancel);
    run.progress = null;
    // Identity guard: a later run may already own the worker if this one is unwinding slowly.
    if (activeRun === run) activeRun = null;
  }
}

function toWord(w: TesseractWord): OcrWord {
  return {
    text: w.text ?? '',
    confidence: typeof w.confidence === 'number' ? w.confidence : 0,
    bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 },
  };
}

/**
 * Stop everything and release the workers.
 *
 * Called from the Stop button and from component unmount. Terminating mid-job leaves the
 * recognise promise permanently pending inside tesseract.js, which is why every in-flight job is
 * rejected here first — otherwise a page loop would sit forever on a job whose worker is gone.
 *
 * Rejecting the in-flight job is NOT on its own enough to stop a run: bumping `generation` is
 * what stops the loop's next iteration (`ensureRunLive`). Stop pressed while a page is being
 * rendered rejects nothing at all, and without the counter the loop would sail on.
 */
export async function terminateOcr(): Promise<void> {
  generation += 1;
  for (const reject of inFlight) reject(new OcrCancelledError());
  inFlight.clear();
  workers.clear();
  const running = [...live];
  live.clear();
  await Promise.all(running.map((w) => w.terminate().catch(() => undefined)));
}

/**
 * Grayscale and, if needed, downscale — the two preprocessing steps that pay for themselves.
 *
 * Tesseract binarises internally, so colour information is discarded either way; doing it here
 * costs one canvas pass and roughly halves recognition time on photographs. Deskewing and
 * denoising are deliberately NOT done: both need parameters that depend on the scan, and a bad
 * guess makes the result worse, silently.
 */
export function prepareForOcr(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): HTMLCanvasElement {
  const { width, height } = fitWithin(
    sourceWidth,
    sourceHeight,
    MAX_OCR_DIMENSION,
    MAX_OCR_DIMENSION,
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new OcrLoadError('noCanvasContext', 'Your browser did not provide a 2D canvas context.');
  }
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  for (let i = 0; i < px.length; i += 4) {
    // Rec. 601 luma. Averaging the channels instead loses contrast on the blue-on-white and
    // red-stamp text that turns up on scanned forms.
    const grey = 0.299 * (px[i] ?? 0) + 0.587 * (px[i + 1] ?? 0) + 0.114 * (px[i + 2] ?? 0);
    px[i] = grey;
    px[i + 1] = grey;
    px[i + 2] = grey;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
