/**
 * The JSZip half of unzip-archive: plain, unencrypted zips, with no WebAssembly involved.
 *
 * Two things here exist only because JSZip's integer reader is signed and 32-bit:
 *
 *   - the sizes the bomb ceiling is computed from are read out of the central directory by
 *     `zip-central-directory.ts` rather than taken from JSZip (see that file for the measured
 *     numbers), and
 *   - `unsignedSize` still repairs the one case JSZip does hand back — a 4-byte size at or past
 *     2 GiB, which arrives negative — because that is what the entry list displays.
 */
import {
  ArchiveError,
  type ExtractionBudget,
  enforceArchiveLimits,
  unsignedSize,
} from './archive-limits';
import { type ZipCentralDirectory, readZipCentralDirectory } from './zip-central-directory';

export type JsZipSession = {
  engine: 'jszip';
  entries: { path: string; size: number }[];
  extract(path: string): Promise<Blob>;
  close(): Promise<void>;
};

/** JSZip publishes the central-directory size only on this internal field. */
type JsZipEntryInternals = { _data?: { uncompressedSize?: number } };

/**
 * JSZip's streaming reader, named structurally: its published types describe `internalStream`
 * loosely, and these three methods are the whole surface used here.
 */
type JsZipStream = {
  on(event: 'data', handler: (chunk: Uint8Array) => void): JsZipStream;
  on(event: 'error', handler: (error: Error) => void): JsZipStream;
  on(event: 'end', handler: () => void): JsZipStream;
  pause(): JsZipStream;
  resume(): JsZipStream;
};

/**
 * Refuse on the archive's own numbers before JSZip allocates anything.
 *
 * An unknown size is refused rather than counted as zero: a ZIP64 header JSZip cannot read is
 * the exact shape that let a 5 GiB declaration through as 1 GiB.
 */
function enforceDeclaredLimits(directory: ZipCentralDirectory): Map<string, number> {
  const sizes = new Map<string, number>();
  const counted: { size: number }[] = [];
  for (const entry of directory.entries) {
    if (entry.size === null) {
      throw new ArchiveError(
        'zip64SizeUnknown',
        `"${entry.name}" declares a ZIP64 size that this reader cannot read back, so its real size is unknown. The archive is refused rather than opened — an entry of unknown size is how a zip bomb gets past a size limit.`,
        { name: entry.name },
      );
    }
    sizes.set(entry.name, entry.size);
    counted.push({ size: entry.size });
  }
  enforceArchiveLimits(counted, directory.declaredEntryCount);
  return sizes;
}

/**
 * True when JSZip's loader will rewrite this name — it drops `.`, `..` and interior empty
 * segments as it resolves each entry path (its `utils.resolve`).
 */
function collapsesOnLoad(name: string): boolean {
  const parts = name.split('/');
  return parts.some(
    (part, i) =>
      part === '.' || part === '..' || (part === '' && i !== 0 && i !== parts.length - 1),
  );
}

/**
 * Two entries whose paths resolve to the same name become one: JSZip keys its file map on the
 * resolved path, so `../config.json` lands on top of `config.json` and one of the two is gone
 * before this tool ever sees the list. There is no way to get it back through JSZip, so the
 * archive is refused rather than listed one file short of what it holds.
 *
 * Both conditions are required. A count on its own is not evidence: an entry marked as a
 * directory by its attributes rather than by a trailing slash also makes the numbers differ,
 * and refusing an ordinary archive over that would be a bug of its own.
 */
function assertNothingCollapsed(directory: ZipCentralDirectory, loadedFiles: number): void {
  const names = directory.entries.filter((e) => !e.name.endsWith('/')).map((e) => e.name);
  if (loadedFiles >= names.length || !names.some(collapsesOnLoad)) return;
  throw new ArchiveError(
    'pathsCollapsed',
    `This archive holds ${names.length} files but only ${loadedFiles} of them have distinct paths: at least one entry uses "../" or "./" to land on the same path as another, and the zip reader here keeps only the last. It is refused rather than opened one file short — a desktop archiver will show you what is really inside.`,
    { files: names.length, distinct: loadedFiles },
  );
}

/**
 * Displayed size for one entry. Only reached for names the central directory did not yield —
 * an archive whose names are in a legacy code page, where our UTF-8 decode and JSZip's disagree.
 */
function displayedSize(file: unknown, path: string): number {
  const declared = (file as JsZipEntryInternals)._data?.uncompressedSize;
  if (declared === undefined) {
    // JSZip reports no size at all for a ZIP64 field at or past 4 GiB. Calling that zero is
    // what a bomb needs; refusing is the only honest reading of "we do not know".
    throw new ArchiveError(
      'untrustedSize',
      `"${path}" does not state a size this reader can trust. The archive is refused rather than opened.`,
      { path },
    );
  }
  return unsignedSize(declared);
}

/**
 * Read one entry, counting the bytes as they arrive.
 *
 * `async('blob')` would inflate the whole entry first and only then let us look at it, which is
 * useless against an entry that declares 1 KB and expands to 3 GB: the tab is already gone.
 * JSZip's internal stream hands over ~16 KB at a time, so the budget can stop it mid-entry.
 */
async function extractCounted(file: object, budget: ExtractionBudget): Promise<Blob> {
  // JSZip ships and documents `internalStream` but leaves it out of its .d.ts, so the method
  // has to be named here. `JsZipStream` above is the contract this depends on.
  const streaming = file as { internalStream(type: 'uint8array'): JsZipStream };
  const stream = streaming.internalStream('uint8array');
  const chunks: Uint8Array[] = [];
  await new Promise<void>((resolve, reject) => {
    stream
      .on('data', (chunk) => {
        try {
          budget.spend(chunk.length);
        } catch (e) {
          // Pause before rejecting: otherwise JSZip keeps inflating into a promise nobody is
          // waiting on, which is the memory this check exists to save.
          stream.pause();
          reject(
            e instanceof Error
              ? e
              : new ArchiveError('extractFailed', String(e), { detail: String(e) }),
          );
          return;
        }
        chunks.push(chunk);
      })
      .on('error', reject)
      .on('end', resolve)
      .resume();
  });
  return new Blob(chunks as BlobPart[]);
}

export async function openWithJsZip(file: File, budget: ExtractionBudget): Promise<JsZipSession> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // No central directory to read means this is not a zip JSZip will load either; let it say so.
  const directory = readZipCentralDirectory(bytes);
  const declared = directory ? enforceDeclaredLimits(directory) : new Map<string, number>();

  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(bytes);
  const files = Object.values(zip.files).filter((f) => !f.dir);
  if (directory) assertNothingCollapsed(directory, files.length);

  const entries = files.map((f) => ({
    path: f.name,
    size: declared.get(f.name) ?? displayedSize(f, f.name),
  }));
  // Re-run the ceiling over the exact list the user is about to see. Identical numbers in the
  // ordinary case; the backstop for an archive whose directory could not be read above.
  enforceArchiveLimits(entries);

  return {
    engine: 'jszip',
    entries,
    async extract(path) {
      const entry = zip.file(path);
      if (!entry)
        throw new ArchiveError('notInArchive', `"${path}" is not in this archive.`, { path });
      return extractCounted(entry, budget);
    },
    async close() {
      // Nothing to release: JSZip holds only the buffer, which the caller drops with us.
    },
  };
}
