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
 */

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

type CompressedEntry = {
  file: { name: string; size: number; extract(): Promise<File> };
  path: string;
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

async function withTimeout<T>(work: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
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
  }
}

/** Turns libarchive's own wording into something a person can act on. */
function readable(e: unknown, hadPassword: boolean): Error {
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
 * List an archive's entries without extracting them. Sizes come from the archive's own headers,
 * which is what makes the zip-bomb check in logic.ts possible before any byte is inflated.
 */
export async function openWithLibarchive(
  file: File,
  password?: string,
): Promise<LibarchiveSession> {
  const Archive = await loadArchive();
  let reader: Awaited<ReturnType<typeof Archive.open>>;
  try {
    reader = await withTimeout(Archive.open(file), 'Opening the archive');
    if (password) await reader.usePassword(password);
  } catch (e) {
    throw readable(e, Boolean(password));
  }

  let listed: CompressedEntry[];
  try {
    listed = (await withTimeout(
      reader.getFilesArray(),
      'Reading the file list',
    )) as CompressedEntry[];
  } catch (e) {
    await reader.close();
    throw readable(e, Boolean(password));
  }

  // `path` is the folder the entry sits in ("docs/") and `name` its basename; the full path is
  // the two joined. The CompressedFile keeps the real internal path for extraction.
  const byPath = new Map(listed.map((e) => [`${e.path}${e.file.name}`, e]));

  return {
    engine: 'libarchive',
    entries: [...byPath].map(([path, e]) => ({ path, size: e.file.size })),
    async extract(path) {
      const entry = byPath.get(path);
      if (!entry) throw new Error(`"${path}" is not in this archive.`);
      try {
        return await entry.file.extract();
      } catch (e) {
        throw readable(e, Boolean(password));
      }
    },
    async close() {
      // Terminates the worker, which is what frees the WASM heap holding the whole archive.
      await reader.close();
    },
  };
}
