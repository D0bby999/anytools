/**
 * The libarchive.js half of unzip-archive, kept apart so `logic.ts` can be read (and tested)
 * without dragging a WebAssembly worker into scope.
 *
 * libarchive.js loads two files at runtime: its worker bundle, and the ~1 MB .wasm the worker
 * fetches next to itself. Left alone it resolves both relative to its own module URL, which
 * under a bundler means an emitted chunk path that does not exist — or, for other libraries in
 * this repository, a public CDN. Both are staged into public/third-party/libarchive/ by
 * scripts/copy-vendor-assets.mjs, and `workerUrl` below is what points at them. The .wasm needs
 * no separate setting: the worker resolves it against its own URL, so it must sit beside the
 * worker bundle, which is exactly how the manifest stages it.
 *
 * Neither file is requested until openWithLibarchive runs — that is the whole reason the
 * format check in logic.ts happens first.
 *
 * Every reader opened here owns a Web Worker holding the whole archive in the WASM heap. There
 * is exactly one way to free it — `close()` — so every path out of this module that is not a
 * returned session closes first. A wrong password, an archive over the size ceiling and a
 * start-up timeout all used to leak one worker each.
 */
import { deduplicatePaths } from '../shared/archive-path';
import {
  ArchiveError,
  type ExtractionBudget,
  enforceArchiveLimits,
  unsignedSize,
} from './archive-limits';

const WORKER_URL = '/third-party/libarchive/worker-bundle.js';

/**
 * Spawning the worker and instantiating the WASM should take about a second. If the worker URL
 * is wrong the library's promise simply never settles, and the user watches a spinner forever;
 * a bounded wait turns that into a sentence.
 */
const START_TIMEOUT_MS = 45_000;

export type LibarchiveSession = {
  engine: 'libarchive';
  entries: { path: string; size: number }[];
  extract(path: string): Promise<Blob>;
  close(): Promise<void>;
};

export type CompressedEntry = {
  file: { name: string; size: number; extract(): Promise<File> };
  path: string;
};

/** The part of libarchive.js's Archive this module uses — named so a test can stand in for it. */
export type LibarchiveReader = {
  usePassword(password: string): Promise<void>;
  getFilesArray(): Promise<CompressedEntry[]>;
  close(): Promise<void>;
};

let initialised = false;

async function loadArchive() {
  const { Archive } = await import('libarchive.js');
  if (!initialised) {
    Archive.init({ workerUrl: WORKER_URL });
    initialised = true;
  }
  return Archive;
}

/** Closing can fail too; when it does, the failure being handled is the one worth reporting. */
async function closeQuietly(reader: Pick<LibarchiveReader, 'close'>): Promise<void> {
  try {
    await reader.close();
  } catch {
    // Deliberately swallowed: see above.
  }
}

/**
 * Wait for `work`, but not forever.
 *
 * `dispose` matters on the timeout path: the value can still arrive after we have given up, and
 * for `Archive.open` that value is a live worker. Without this it would run until the tab closes.
 */
async function withTimeout<T>(
  work: Promise<T>,
  what: string,
  dispose?: (value: T) => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let arrived = false;
  try {
    return await Promise.race([
      work.then((value) => {
        arrived = true;
        return value;
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${what} did not finish within ${START_TIMEOUT_MS / 1000} seconds. The archive engine may have failed to start — that is a bug on our side, not a problem with your file.`,
              ),
            ),
          START_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (!arrived && dispose) void work.then(dispose, () => undefined);
  }
}

/** Turns libarchive's own wording into something a person can act on. */
function readable(e: unknown, hadPassword: boolean): Error {
  if (e instanceof ArchiveError) return e;
  const message = e instanceof Error ? e.message : String(e);
  if (/passphrase|password|encrypt/i.test(message)) {
    return new Error(
      hadPassword
        ? 'That password did not open the archive. Check it and try again — for RAR files, note that a file list can be readable while the contents are not.'
        : 'This archive is encrypted. Enter its password and open it again.',
    );
  }
  if (/unrecognized|not.*(supported|recognized)|format/i.test(message)) {
    return new Error(
      `This archive could not be read: ${message}. Some variants (solid RAR5 with encrypted headers, for example) are outside what the reader supports.`,
    );
  }
  return new Error(`This archive could not be read: ${message}`);
}

/**
 * Turn an opened reader into a session: unlock it, list it, check it against the zip-bomb
 * ceiling. Split out from the opening so the close-on-failure contract can be tested without a
 * worker — every throw below closes the reader first.
 */
export async function sessionFromReader(
  reader: LibarchiveReader,
  budget: ExtractionBudget,
  password?: string,
): Promise<LibarchiveSession> {
  // Only the boolean survives into the closures below. The password itself is needed for the
  // unlock and nothing else, and a session can outlive the screen the user typed it on.
  const hadPassword = Boolean(password);
  let listed: CompressedEntry[];
  try {
    if (password) await reader.usePassword(password);
    listed = await withTimeout(reader.getFilesArray(), 'Reading the file list');
  } catch (e) {
    await closeQuietly(reader);
    throw readable(e, hadPassword);
  }

  // `path` is the folder the entry sits in ("docs/") and `name` its basename; the full path is
  // the two joined. Two entries can legitimately carry the same full path — tar keeps every
  // version of a file it was given — and a Map keyed on that path would drop all but the last,
  // so the listing would be missing a file the archive really contains.
  const paths = deduplicatePaths(listed.map((e) => `${e.path}${e.file.name}`));
  const byPath = new Map<string, CompressedEntry>();
  for (const [i, entry] of listed.entries()) {
    byPath.set(paths[i] ?? `${entry.path}${entry.file.name}`, entry);
  }
  // unsignedSize, not e.file.size: libarchive hands a 3 GB entry back as -1,073,741,824, and a
  // negative size both displays as nonsense and slips under the ceiling. Measured in the lane.
  const entries = [...byPath].map(([path, e]) => ({ path, size: unsignedSize(e.file.size) }));

  try {
    enforceArchiveLimits(entries);
  } catch (e) {
    await closeQuietly(reader);
    throw e;
  }

  return {
    engine: 'libarchive',
    entries,
    async extract(path) {
      const entry = byPath.get(path);
      if (!entry) throw new ArchiveError(`"${path}" is not in this archive.`);
      let extracted: File;
      try {
        extracted = await entry.file.extract();
      } catch (e) {
        throw readable(e, hadPassword);
      }
      // The worker hands back one whole file at a time, so unlike the jszip path the running
      // ceiling can only be applied between entries — this is the first moment the real size
      // of this one is known, whatever its header claimed.
      budget.spend(extracted.size);
      return extracted;
    },
    async close() {
      // Terminates the worker, which is what frees the WASM heap holding the whole archive.
      await reader.close();
    },
  };
}

/**
 * List an archive's entries without extracting them. Sizes come from the archive's own headers,
 * which is what makes the zip-bomb check possible before any byte is inflated.
 */
export async function openWithLibarchive(
  file: File,
  budget: ExtractionBudget,
  password?: string,
): Promise<LibarchiveSession> {
  const Archive = await loadArchive();
  let reader: LibarchiveReader;
  try {
    reader = (await withTimeout(Archive.open(file), 'Opening the archive', (opened) => {
      void closeQuietly(opened as unknown as LibarchiveReader);
    })) as unknown as LibarchiveReader;
  } catch (e) {
    throw readable(e, Boolean(password));
  }
  return sessionFromReader(reader, budget, password);
}
