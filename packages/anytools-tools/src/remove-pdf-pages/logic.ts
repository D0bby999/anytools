import { parsePageRange } from '../shared/page-range';

export type RemoveResult = {
  blob: Blob;
  /** Pages left after the removal. */
  pages: number;
  /** How many were taken out. */
  removed: number;
};

export class PdfRemoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfRemoveError';
  }
}

/** Page count without modifying anything — the UI validates the range against it. */
export async function readPageCount(file: File): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  try {
    return (await PDFDocument.load(await file.arrayBuffer())).getPageCount();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/encrypt/i.test(msg)) {
      throw new PdfRemoveError(
        `"${file.name}" is password-protected. Remove the password and try again.`,
      );
    }
    throw new PdfRemoveError(`"${file.name}" could not be read as a PDF.`);
  }
}

export async function removePdfPages(file: File, range: string): Promise<RemoveResult> {
  const { PDFDocument } = await import('pdf-lib');
  const doc = await PDFDocument.load(await file.arrayBuffer()).catch(() => {
    throw new PdfRemoveError(`"${file.name}" could not be read as a PDF.`);
  });

  const pageCount = doc.getPageCount();
  const indices = parsePageRange(range, { pageCount });

  if (indices.length >= pageCount) {
    throw new PdfRemoveError(
      'That would remove every page. A PDF needs at least one page — keep one, or delete the file instead.',
    );
  }

  // HIGHEST INDEX FIRST. removePage() re-indexes the pages after it, so deleting 0 then 2
  // from a six-page document removes the original pages 1 and 4, not 1 and 3. Going
  // downwards means no surviving index has shifted by the time it is used.
  for (const index of [...indices].sort((a, b) => b - a)) doc.removePage(index);

  const bytes = await doc.save();
  return {
    blob: new Blob([bytes.slice()], { type: 'application/pdf' }),
    pages: doc.getPageCount(),
    removed: indices.length,
  };
}
