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
 * Zip `files`, reporting 0–100 as jszip writes.
 *
 * `streamFiles: true` makes jszip emit each entry as it is produced instead of holding the
 * finished archive in a second buffer; on a large selection that is the difference between
 * working and an out-of-memory tab. It writes data descriptors — a normal, thirty-year-old
 * zip feature — rather than seeking back to patch each local header.
 */
export async function createZip(
  files: File[],
  options: CreateZipOptions,
  onProgress?: (percent: number) => void,
): Promise<CreateZipResult> {
  if (files.length === 0) throw new CreateZipError('Choose at least one file to zip.');

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
    // arrayBuffer() rather than the File itself: it is what the browser already holds for a
    // picked file, and it keeps the entry's byte length knowable before compression starts.
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

  return {
    blob,
    paths,
    inputBytes: files.reduce((n, f) => n + f.size, 0),
    outputBytes: blob.size,
  };
}
