// pdf-lib is imported dynamically, never at module top level. dynamic-tool-renderer
// already code-splits per tool, but a top-level import would still pull ~173 KB gzipped
// into anything that touches this module — a test helper, a future registry, a barrel
// re-export. Loading it at call time keeps that impossible rather than merely unlikely.
import { ToolError } from '../shared/tool-error';

export type MergeResult = {
  blob: Blob;
  /** Page count of the merged document. */
  pages: number;
  /** Per-input page counts, in the order supplied. */
  sources: { name: string; pages: number }[];
};

export class PdfMergeError extends ToolError {
  /** The input that failed, so the UI can name it. Read from `params.name`. */
  readonly fileName?: string;

  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'PdfMergeError';
    if (typeof params.name === 'string') this.fileName = params.name;
  }
}

/**
 * Concatenate PDFs in the order given.
 *
 * Encrypted inputs are rejected by name rather than skipped. pdf-lib can be told to ignore
 * encryption, but the result is a document whose restrictions have been stripped — quietly
 * doing that to a file someone password-protected is not a merge, it is a bypass.
 */
export async function mergePdfs(files: File[]): Promise<MergeResult> {
  if (files.length < 2) {
    throw new PdfMergeError('needTwoPdfs', 'Choose at least two PDFs to merge.');
  }

  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  const sources: { name: string; pages: number }[] = [];

  for (const file of files) {
    let src: Awaited<ReturnType<typeof PDFDocument.load>>;
    try {
      src = await PDFDocument.load(await file.arrayBuffer());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/encrypt/i.test(msg)) {
        throw new PdfMergeError(
          'pdfPasswordProtected',
          `"${file.name}" is password-protected. Remove the password and try again.`,
          { name: file.name },
        );
      }
      throw new PdfMergeError('pdfUnreadable', `"${file.name}" could not be read as a PDF.`, {
        name: file.name,
      });
    }
    const copied = await out.copyPages(src, src.getPageIndices());
    for (const page of copied) out.addPage(page);
    sources.push({ name: file.name, pages: copied.length });
  }

  const bytes = await out.save();
  return {
    // Copy into a fresh ArrayBuffer: pdf-lib returns a view over a pooled buffer, and
    // handing that straight to Blob can capture more than the document's own bytes.
    blob: new Blob([bytes.slice()], { type: 'application/pdf' }),
    pages: out.getPageCount(),
    sources,
  };
}
