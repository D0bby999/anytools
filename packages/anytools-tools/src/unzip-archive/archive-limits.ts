/**
 * The two things that stand between a zip bomb and a dead browser tab.
 *
 * There are deliberately two layers, because they fail differently:
 *
 *   1. `enforceArchiveLimits` reads the sizes the archive *declares* and refuses before a byte
 *      is inflated. Cheap, and it catches the honest shape of a bomb (a small file that says it
 *      contains 3 GB of zeros).
 *   2. `createExtractionBudget` counts the bytes that actually *come out*. Declared sizes are
 *      written by whoever built the archive, so a bomb can simply state 1 KB and hand over a
 *      deflate stream that expands to gigabytes. Layer 1 is blind to that by construction; only
 *      counting real output catches it.
 */

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
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
 * Reinterpret a size that was built with signed 32-bit arithmetic.
 *
 * Both readers do this, which is why it lives here rather than beside either of them. JSZip
 * assembles its 4-byte size field with `(result << 8) + byte`, so anything from 2 GiB up comes
 * back negative — a 3 GB entry reads as -1,073,741,824. libarchive.js does the same across its
 * worker boundary: the browser lane on 2026-09-03 opened a tar declaring 3 GB and the UI showed
 * `-1048576.0 KB`, with the size ceiling waving it through, because a negative number is not
 * greater than 2 GB.
 *
 * This recovers the true value between 2 and 4 GiB exactly. Past 4 GiB the information is gone
 * before it reaches us; for zips `zip-central-directory.ts` reads the real 64-bit field instead,
 * and for everything else the extraction budget is the backstop.
 */
export const unsignedSize = (n: number): number => (n < 0 ? n + 0x1_0000_0000 : n);

/**
 * Check declared sizes BEFORE extracting anything. Both formats publish the uncompressed size
 * of every entry in their directory, so this costs nothing and runs before a single byte is
 * inflated. Stops at the first entry that crosses a line, and says which one.
 *
 * `declaredEntryCount` lets a caller pass the count the archive states about itself — a zip's
 * end-of-central-directory record gives it in 22 bytes, before anything builds one object per
 * entry — while still defaulting to the length of the list actually in hand.
 */
export function enforceArchiveLimits(
  entries: readonly { size: number }[],
  declaredEntryCount: number = entries.length,
): void {
  const count = Math.max(entries.length, declaredEntryCount);
  if (count > MAX_ENTRIES) {
    throw new ArchiveError(
      `This archive declares ${count.toLocaleString()} entries; the limit is ${MAX_ENTRIES.toLocaleString()}. It is refused rather than opened — an archive that shape is usually a zip bomb.`,
    );
  }
  let total = 0;
  for (const [i, entry] of entries.entries()) {
    // A negative or non-finite size is a misread header. Clamping it to zero used to look like
    // the safe move; it is the opposite — it *lowers* the running total, which is the one
    // direction that hides a bomb. Callers repair signed 32-bit reads with `unsignedSize`
    // first, so anything still negative here is a size nobody can vouch for.
    if (!Number.isFinite(entry.size) || entry.size < 0) {
      throw new ArchiveError(
        `Entry ${i + 1} of ${entries.length} does not state a size this reader can make sense of, so there is no way to know what opening it would cost. It is refused rather than opened.`,
      );
    }
    total += entry.size;
    if (total > MAX_TOTAL_BYTES) {
      throw new ArchiveError(
        `This archive unpacks to more than 2 GB (past the limit at entry ${i + 1} of ${entries.length}). It is refused rather than opened — extracting it would run this tab out of memory.`,
      );
    }
  }
}

/** Counts the bytes an open archive has really produced, across every entry extracted from it. */
export type ExtractionBudget = {
  /** Throws once the running total passes the ceiling. Call it as the bytes arrive. */
  spend(bytes: number): void;
  readonly used: number;
};

/** Round numbers only: this labels a ceiling, never a measurement. */
const ceilingLabel = (bytes: number): string => {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${Math.round(mb / 1024)} GB`;
  return mb >= 1 ? `${Math.round(mb)} MB` : `${Math.round(bytes / 1024)} KB`;
};

export function createExtractionBudget(limit: number = MAX_TOTAL_BYTES): ExtractionBudget {
  let used = 0;
  return {
    spend(bytes: number): void {
      used += Math.max(0, bytes);
      if (used > limit) {
        throw new ArchiveError(
          `Extraction stopped: this archive has already produced more than ${ceilingLabel(limit)}, whatever its directory claimed. A file that decompresses far past its declared size is the definition of a zip bomb.`,
        );
      }
    },
    get used() {
      return used;
    },
  };
}
