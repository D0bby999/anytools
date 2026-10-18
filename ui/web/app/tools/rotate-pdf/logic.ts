import { parsePageRange } from '../shared/page-range';
import { ToolError } from '../shared/tool-error';

/** Clockwise quarter turns to apply. */
export type RotateAngle = 90 | 180 | 270;

export type RotateResult = { blob: Blob; pages: number; rotated: number };

export class PdfRotateError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'PdfRotateError';
  }
}

const unreadable = (file: File) =>
  new PdfRotateError('pdfUnreadable', `"${file.name}" could not be read as a PDF.`, {
    name: file.name,
  });

export async function readPageCount(file: File): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  try {
    return (await PDFDocument.load(await file.arrayBuffer())).getPageCount();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/encrypt/i.test(msg)) {
      throw new PdfRotateError(
        'pdfPasswordProtected',
        `"${file.name}" is password-protected. Remove the password and try again.`,
        { name: file.name },
      );
    }
    throw unreadable(file);
  }
}

/**
 * Rotate pages clockwise. `range` empty means every page.
 *
 * Rotation is ADDED to whatever the page already carries rather than assigned. A scanner
 * that saved pages at 270° is the common case, and overwriting that value would silently
 * undo the existing correction while appearing to work.
 */
export async function rotatePdf(file: File, angle: RotateAngle, range = ''): Promise<RotateResult> {
  const { PDFDocument, degrees } = await import('pdf-lib');
  const doc = await PDFDocument.load(await file.arrayBuffer()).catch(() => {
    throw unreadable(file);
  });

  const pageCount = doc.getPageCount();
  const targets = range.trim() ? parsePageRange(range, { pageCount }) : doc.getPageIndices();

  for (const i of targets) {
    const page = doc.getPage(i);
    // Normalise into 0/90/180/270 — a negative or >360 value is legal in the file format
    // but not something viewers agree on.
    const next = (((page.getRotation().angle + angle) % 360) + 360) % 360;
    page.setRotation(degrees(next));
  }

  const bytes = await doc.save();
  return {
    blob: new Blob([bytes.slice()], { type: 'application/pdf' }),
    pages: pageCount,
    rotated: targets.length,
  };
}
