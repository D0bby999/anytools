/**
 * Parse a human page range — "1-3, 7, 9-12" — into zero-based page indices.
 *
 * Shared by split-pdf and remove-pdf-pages. People type these by hand, so the parser has to
 * survive stray spaces, reversed ranges and duplicates without either crashing or silently
 * producing the wrong pages.
 */

export class PageRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageRangeError';
  }
}

export type ParseOptions = {
  /** Total pages in the document. Used to reject out-of-range input. */
  pageCount: number;
};

/**
 * Returns sorted, de-duplicated ZERO-based indices.
 *
 * Input is one-based because that is what a PDF reader shows the user; the return value is
 * zero-based because that is what pdf-lib takes. Getting that boundary wrong is an off-by-one
 * that silently operates on the neighbouring page, so it is stated in both directions here
 * and asserted in the tests.
 */
export function parsePageRange(input: string, { pageCount }: ParseOptions): number[] {
  const trimmed = input.trim();
  if (!trimmed) throw new PageRangeError('Enter at least one page or range, e.g. 1-3, 7.');
  if (pageCount < 1) throw new PageRangeError('The document has no pages.');

  const out = new Set<number>();

  for (const rawPart of trimmed.split(',')) {
    const part = rawPart.trim();
    if (!part) continue; // tolerate "1,,3" and a trailing comma

    // Accept the hyphen people type and the dashes an editor may substitute.
    const match = part.match(/^(\d+)\s*(?:[-–—]\s*(\d+))?$/);
    if (!match) {
      throw new PageRangeError(`"${part}" is not a page or a range. Use formats like 4 or 2-6.`);
    }

    const first = Number(match[1]);
    // A bare number is a one-page range; treating it as such keeps one code path.
    const second = match[2] === undefined ? first : Number(match[2]);
    if (first < 1 || second < 1) throw new PageRangeError('Pages start at 1.');

    // "5-2" is a reversed range. Read it as 2-5 rather than rejecting it — the intent is
    // unambiguous, and rejecting it only teaches the user to retype it in the other order.
    const lo = Math.min(first, second);
    const hi = Math.max(first, second);
    if (hi > pageCount) {
      throw new PageRangeError(
        `Page ${hi} does not exist — the document has ${pageCount} ${
          pageCount === 1 ? 'page' : 'pages'
        }.`,
      );
    }
    for (let p = lo; p <= hi; p++) out.add(p - 1);
  }

  if (out.size === 0) throw new PageRangeError('Enter at least one page or range, e.g. 1-3, 7.');
  return [...out].sort((a, b) => a - b);
}

/**
 * Split into contiguous runs, so "1-3, 7" yields two output documents rather than one of
 * four pages. Input must be sorted and unique — parsePageRange guarantees both.
 */
export function toContiguousRuns(indices: number[]): number[][] {
  const runs: number[][] = [];
  for (const i of indices) {
    const last = runs.at(-1);
    if (last && i === (last.at(-1) ?? -2) + 1) last.push(i);
    else runs.push([i]);
  }
  return runs;
}
