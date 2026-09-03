/**
 * Build a .zip from files the user picked, in the tab.
 *
 * jszip is already a dependency (pdf-to-png packages its page renders with it), so this tool
 * adds no new third-party code to the site. It is imported dynamically all the same: the
 * library is ~100 KB and nobody who lands on the page and reads the FAQ should pay for it.
 */
import { deduplicatePaths, normaliseArchivePath } from '../shared/archive-path';

/** DEFLATE levels as jszip exposes them. 0 means "store", which jszip spells differently. */
export type CompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type CreateZipOptions = {
  level: CompressionLevel;
  /** Optional single folder to nest everything under, so unzipping does not litter a folder. */
  rootFolder?: string;
};

export type CreateZipResult = {
  blob: Blob;
  /** Paths as they were written, in input order — the UI shows these, renames included. */
  paths: string[];
  inputBytes: number;
  outputBytes: number;
};

export class CreateZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreateZipError';
  }
}

/**
 * Work out the entry path for every input file before anything is compressed.
 *
 * Kept separate from the zipping so it can be tested without a zip: two files with the same
 * name would otherwise overwrite each other inside the archive, and a name carrying `../`
 * would be written into the output verbatim (see shared/archive-path).
 */
export function planEntryPaths(names: string[], rootFolder?: string): string[] {
  const root = rootFolder?.trim() ? normaliseArchivePath(rootFolder.trim()) : '';
  const cleaned = names.map((n) => normaliseArchivePath(n));
  return deduplicatePaths(cleaned).map((p) => (root ? `${root}/${p}` : p));
}

/**
 * A zip's offsets and sizes are 32-bit fields, and jszip 3.10 does not write the ZIP64 records
 * that extend them. Past 4 GiB the numbers wrap and the archive is quietly wrong: extractors
 * report a corrupt file, or worse, hand back truncated data without complaining. Refusing is
 * the only honest answer, and it has to happen before compression rather than after.
 */
export const MAX_TOTAL_INPUT_BYTES = 4 * 1024 * 1024 * 1024;

const fmtGb = (n: number) => `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;

/**
 * Zip `files`, reporting 0–100 as jszip writes.
 *
 * This holds everything in memory, and there is no arrangement of jszip options that avoids it:
 * `zip.file()` resolves each input to an ArrayBuffer up front (hand it a File and jszip reads
 * the whole Blob with a FileReader instead — same peak), and `generateAsync({type:'blob'})`
 * gathers the result into one Blob. Peak use is therefore roughly input + output. `streamFiles:
 * true` changes the *format*, not the memory: jszip writes data descriptors after each entry
 * rather than seeking back to patch its local header. MAX_TOTAL_INPUT_BYTES is what actually
 * stands between a huge selection and a dead tab.
 */
export async function createZip(
  files: File[],
  options: CreateZipOptions,
  onProgress?: (percent: number) => void,
): Promise<CreateZipResult> {
  if (files.length === 0) throw new CreateZipError('Choose at least one file to zip.');

  const inputBytes = files.reduce((n, f) => n + f.size, 0);
  if (inputBytes >= MAX_TOTAL_INPUT_BYTES) {
    throw new CreateZipError(
      `These files come to ${fmtGb(inputBytes)}, and a zip written here has to stay under ${fmtGb(MAX_TOTAL_INPUT_BYTES)}: the format's size fields are 32-bit and this writer does not emit the ZIP64 records that extend them. Past that point the archive would be silently corrupt, so it is refused instead. Zip them in two batches, or use a desktop archiver.`,
    );
  }

  const paths = planEntryPaths(
    files.map((f) => f.name),
    options.rootFolder,
  );

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const path = paths[i];
    if (!file || !path) continue;
    // arrayBuffer() rather than the File itself. Not for memory — jszip would read the Blob
    // whole anyway — but because reading here fails loudly, on this line, if the user moved or
    // deleted the file after picking it, instead of somewhere inside generateAsync.
    zip.file(path, await file.arrayBuffer(), { date: new Date(file.lastModified) });
  }

  const blob = await zip.generateAsync(
    {
      type: 'blob',
      streamFiles: true,
      // Level 0 is not a DEFLATE level in jszip's API, it selects a different method.
      // compressionOptions is ignored for STORE, so the fallback level is never used.
      compression: options.level === 0 ? 'STORE' : 'DEFLATE',
      compressionOptions: { level: options.level === 0 ? 1 : options.level },
    },
    (meta) => onProgress?.(Math.round(meta.percent)),
  );

  return { blob, paths, inputBytes, outputBytes: blob.size };
}
