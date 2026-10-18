import { parsePageRange, toContiguousRuns } from '../shared/page-range';
import { ToolError } from '../shared/tool-error';

// pdf-lib and jszip are both imported at call time, never at module scope. jszip in
// particular is only needed for the multi-file mode, so a user extracting one range never
// downloads it.

export type SplitMode =
  /** One output document per contiguous run in the range. */
  | { kind: 'ranges'; range: string }
  /** One output document per page. */
  | { kind: 'each' };

export type SplitPart = { name: string; pages: number; blob: Blob };

export type SplitResult = {
  parts: SplitPart[];
  /** Present when there is more than one part. */
  zip?: Blob;
};

export class PdfSplitError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'PdfSplitError';
  }
}

async function loadDoc(file: File) {
  const { PDFDocument } = await import('pdf-lib');
  try {
    return await PDFDocument.load(await file.arrayBuffer());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/encrypt/i.test(msg)) {
      throw new PdfSplitError(
        'pdfPasswordProtected',
        `"${file.name}" is password-protected. Remove the password and try again.`,
        { name: file.name },
      );
    }
    throw new PdfSplitError('pdfUnreadable', `"${file.name}" could not be read as a PDF.`, {
      name: file.name,
    });
  }
}

/** Page count without splitting — the UI needs it to validate a range as it is typed. */
export async function readPageCount(file: File): Promise<number> {
  return (await loadDoc(file)).getPageCount();
}

export async function splitPdf(file: File, mode: SplitMode): Promise<SplitResult> {
  const { PDFDocument } = await import('pdf-lib');
  const src = await loadDoc(file);
  const pageCount = src.getPageCount();
  const base = file.name.replace(/\.pdf$/i, '');

  const groups: number[][] =
    mode.kind === 'each'
      ? src.getPageIndices().map((i) => [i])
      : toContiguousRuns(parsePageRange(mode.range, { pageCount }));

  if (groups.length === 0) throw new PdfSplitError('nothingToExtract', 'Nothing to extract.');

  const parts: SplitPart[] = [];
  for (const indices of groups) {
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, indices);
    for (const p of copied) out.addPage(p);
    const bytes = await out.save();
    // Name by the ONE-BASED pages the user sees, not the indices pdf-lib used.
    const first = (indices[0] ?? 0) + 1;
    const last = (indices.at(-1) ?? 0) + 1;
    parts.push({
      name: first === last ? `${base}-p${first}.pdf` : `${base}-p${first}-${last}.pdf`,
      pages: indices.length,
      blob: new Blob([bytes.slice()], { type: 'application/pdf' }),
    });
  }

  if (parts.length === 1) return { parts };

  // Several files: browsers block multiple sequential downloads, so bundle them. Loaded
  // here rather than at module scope so single-range users never pay for it.
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const p of parts) zip.file(p.name, await p.blob.arrayBuffer());
  return { parts, zip: await zip.generateAsync({ type: 'blob' }) };
}
