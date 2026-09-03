/**
 * Open zip, 7z, rar, tar and gzip archives in the tab.
 *
 * Two engines, chosen by magic bytes rather than by file extension:
 *
 *   jszip        plain zip. Already a dependency, ~100 KB, no WASM.
 *   libarchive   everything else, and encrypted zips. A ~1 MB WebAssembly build of the C
 *                library, which is why it is behind a dynamic import AND behind the format
 *                check: someone who only ever opens a zip must never pay for it. The worker
 *                and its .wasm are served from this origin (see vendor-assets.json); the
 *                library would otherwise resolve them relative to its own bundle.
 */
import { normaliseArchivePath } from '../shared/archive-path';
import { type LibarchiveSession, openWithLibarchive } from './libarchive-session';

export type ArchiveKind = 'zip' | '7z' | 'rar' | 'tar' | 'gzip';

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}

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

/**
 * Zip-bomb ceilings.
 *
 * A 42 KB archive can declare petabytes; extracting it is how a browser tab dies. Both numbers
 * come from what a tab can survive rather than from any standard: 2 GB of extracted bytes is
 * already beyond what most machines will hold in one page, and 50,000 entries is far past any
 * archive a person opens by hand while still catching the "10 million empty files" shape.
 */
export const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_ENTRIES = 50_000;

/**
 * Check declared sizes BEFORE extracting anything. Both formats publish the uncompressed size
 * of every entry in their directory, so this costs nothing and runs before a single byte is
 * inflated. Stops at the first entry that crosses a line, and says which one.
 */
export function enforceArchiveLimits(entries: readonly { size: number }[]): void {
  if (entries.length > MAX_ENTRIES) {
    throw new ArchiveError(
      `This archive declares ${entries.length.toLocaleString()} entries; the limit is ${MAX_ENTRIES.toLocaleString()}. It is refused rather than opened — an archive that shape is usually a zip bomb.`,
    );
  }
  let total = 0;
  for (const [i, entry] of entries.entries()) {
    // A negative size can only come from a misread header, and letting one through would
    // *lower* the running total — the one direction that hides a bomb instead of catching it.
    total += Math.max(0, entry.size);
    if (total > MAX_TOTAL_BYTES) {
      throw new ArchiveError(
        `This archive unpacks to more than 2 GB (past the limit at entry ${i + 1} of ${entries.length}). It is refused rather than opened — extracting it would run this tab out of memory.`,
      );
    }
  }
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

/** jszip publishes the central-directory size only on this internal field. */
type JsZipEntryInternals = { _data?: { uncompressedSize?: number } };

/**
 * Reinterpret a zip's 4-byte size field as unsigned.
 *
 * jszip builds it with `(result << 8) + byte`, which is a signed 32-bit operation, so anything
 * from 2 GiB up comes back negative: a 3 GB entry reads as -1,073,741,824. Found in the
 * browser lane on 2026-09-03 — a real 3 GB zip bomb walked straight through the size ceiling
 * because a negative number is not greater than 2 GB. Unit tests over the guard alone could
 * not have caught it; the bad number is made outside the guard.
 */
export const unsignedSize = (n: number): number => (n < 0 ? n + 0x1_0000_0000 : n);

async function openWithJsZip(file: File): Promise<ArchiveSession> {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const files = Object.values(zip.files).filter((f) => !f.dir);
  const entries = files.map((f) => ({
    path: f.name,
    size: unsignedSize((f as unknown as JsZipEntryInternals)._data?.uncompressedSize ?? 0),
  }));
  enforceArchiveLimits(entries);
  return {
    kind: 'zip',
    engine: 'jszip',
    entries,
    async extract(path) {
      const entry = zip.file(path);
      if (!entry) throw new ArchiveError(`"${path}" is not in this archive.`);
      return entry.async('blob');
    },
    async close() {
      // Nothing to release: jszip holds only the buffer, which the caller drops with us.
    },
  };
}

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
      `"${file.name}" does not look like a zip, 7z, rar, tar or gzip archive — its first bytes match none of them.`,
    );
  }

  if (kind === 'zip') {
    try {
      return await openWithJsZip(file);
    } catch (e) {
      if (!isEncryptedZip(e)) throw e;
      // Encrypted zips are libarchive's job — and it cannot do anything without the password,
      // so ask before spending a megabyte of WebAssembly on a certain failure.
      if (!password) {
        throw new ArchiveError('This zip is encrypted. Enter its password and open it again.');
      }
    }
  }

  const session: LibarchiveSession = await openWithLibarchive(file, password);
  enforceArchiveLimits(session.entries);
  return { kind, ...session };
}

/**
 * Extract everything and hand back one zip.
 *
 * Browsers suppress the second and later downloads when a page starts several at once, so an
 * archive is the only reliable way to return more than one file. Entry paths are normalised on
 * the way in: an uploaded archive may contain `../` and we will not pass it on.
 */
export async function repackAll(
  session: ArchiveSession,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const [i, entry] of session.entries.entries()) {
    const blob = await session.extract(entry.path);
    zip.file(normaliseArchivePath(entry.path), await blob.arrayBuffer());
    onProgress?.(i + 1, session.entries.length);
  }
  return zip.generateAsync({
    type: 'blob',
    streamFiles: true,
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
