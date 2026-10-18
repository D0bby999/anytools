/**
 * Open zip, 7z, rar, tar and gzip archives in the tab.
 *
 * Two engines, chosen by magic bytes rather than by file extension:
 *
 *   jszip        plain zip. Already a dependency, ~100 KB, no WASM. See jszip-session.ts.
 *   libarchive   everything else, and encrypted zips. A ~1 MB WebAssembly build of the C
 *                library, which is why it is behind a dynamic import AND behind the format
 *                check: someone who only ever opens a zip must never pay for it. The worker
 *                and its .wasm are served from this origin (see vendor-assets.json); the
 *                library would otherwise resolve them relative to its own bundle.
 *
 * Both engines share one extraction budget (archive-limits.ts) for the lifetime of an open
 * archive, so the 2 GB ceiling holds across every file the user pulls out of it.
 */
import { deduplicatePaths, normaliseArchivePath } from '../shared/archive-path';
import { ArchiveError, createExtractionBudget } from './archive-limits';
import { openWithJsZip } from './jszip-session';
import { openWithLibarchive } from './libarchive-session';

export {
  ArchiveError,
  MAX_ENTRIES,
  MAX_TOTAL_BYTES,
  createExtractionBudget,
  enforceArchiveLimits,
} from './archive-limits';

export type ArchiveKind = 'zip' | '7z' | 'rar' | 'tar' | 'gzip';

/**
 * Extensions lie — a `.zip` from a phone is often really a `.rar`, and `.tar.gz` inside a
 * download manager routinely arrives as `.tar.gz.zip`. Every signature below is at a fixed
 * offset in the first 512 bytes.
 */
const SIGNATURES: { kind: ArchiveKind; offset: number; bytes: number[] }[] = [
  { kind: 'zip', offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }, // "PK\x03\x04", normal
  { kind: 'zip', offset: 0, bytes: [0x50, 0x4b, 0x05, 0x06] }, // empty archive
  { kind: 'zip', offset: 0, bytes: [0x50, 0x4b, 0x07, 0x08] }, // spanned/split
  { kind: '7z', offset: 0, bytes: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c] },
  // "Rar!\x1a\x07" prefixes both RAR4 (then 0x00) and RAR5 (then 0x01 0x00).
  { kind: 'rar', offset: 0, bytes: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07] },
  { kind: 'gzip', offset: 0, bytes: [0x1f, 0x8b] },
  // tar has no header magic at all; ustar sits 257 bytes into the first entry header.
  { kind: 'tar', offset: 257, bytes: [0x75, 0x73, 0x74, 0x61, 0x72] },
];

/** Null when nothing matched — the caller reports that, rather than guessing. */
export function detectFormat(head: Uint8Array): ArchiveKind | null {
  for (const { kind, offset, bytes } of SIGNATURES) {
    if (bytes.every((b, i) => head[offset + i] === b)) return kind;
  }
  return null;
}

export async function detectFileFormat(file: File): Promise<ArchiveKind | null> {
  return detectFormat(new Uint8Array(await file.slice(0, 512).arrayBuffer()));
}

export type ArchiveEntry = { path: string; size: number };

export type ArchiveSession = {
  kind: ArchiveKind;
  /** Shown in the UI, and the thing to check when asking "did the WASM load?" */
  engine: 'jszip' | 'libarchive';
  entries: ArchiveEntry[];
  extract(path: string): Promise<Blob>;
  close(): Promise<void>;
};

/** jszip refuses encrypted entries by design; that is a routing signal, not a failure. */
const isEncryptedZip = (e: unknown) =>
  e instanceof Error && /encrypted/i.test(e.message) && !/passphrase|password/i.test(e.message);

/**
 * List an archive. `password` is only consulted on the libarchive path, which is the only one
 * that can decrypt anything.
 */
export async function openArchive(file: File, password?: string): Promise<ArchiveSession> {
  const kind = await detectFileFormat(file);
  if (!kind) {
    throw new ArchiveError(
      'notArchive',
      `"${file.name}" does not look like a zip, 7z, rar, tar or gzip archive — its first bytes match none of them.`,
      { name: file.name },
    );
  }
  const budget = createExtractionBudget();

  if (kind === 'zip') {
    try {
      return { kind, ...(await openWithJsZip(file, budget)) };
    } catch (e) {
      if (!isEncryptedZip(e)) throw e;
      // Encrypted zips are libarchive's job — and it cannot do anything without the password,
      // so ask before spending a megabyte of WebAssembly on a certain failure.
      if (!password) {
        throw new ArchiveError(
          'zipEncrypted',
          'This zip is encrypted. Enter its password and open it again.',
        );
      }
    }
  }

  return { kind, ...(await openWithLibarchive(file, budget, password)) };
}

/**
 * Extract everything and hand back one zip.
 *
 * Browsers suppress the second and later downloads when a page starts several at once, so an
 * archive is the only reliable way to return more than one file. Entry paths are normalised on
 * the way in: an uploaded archive may contain `../` and we will not pass it on — and normalising
 * makes collisions ( `../config.json` and `config.json` both become `config.json`), so the
 * result is de-duplicated too. `zip.file()` overwrites silently, which would drop a file the
 * user was told they had.
 */
export async function repackAll(
  session: ArchiveSession,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const outputPaths = deduplicatePaths(session.entries.map((e) => normaliseArchivePath(e.path)));
  for (const [i, entry] of session.entries.entries()) {
    const blob = await session.extract(entry.path);
    zip.file(outputPaths[i] ?? normaliseArchivePath(entry.path), await blob.arrayBuffer());
    onProgress?.(i + 1, session.entries.length);
  }
  return zip.generateAsync({
    type: 'blob',
    streamFiles: true,
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
