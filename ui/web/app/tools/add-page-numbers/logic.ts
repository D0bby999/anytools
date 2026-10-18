// pdf-lib is imported dynamically inside the function, never at module top level — same reason
// as merge-pdf: a top-level import pulls ~173 KB gzipped into anything that touches this module.
import { parsePageRange } from '../shared/page-range';
import { pageFrame, rethrowAsTextError } from '../shared/pdf-page-stamp';
import { ToolError } from '../shared/tool-error';

export type NumberPosition =
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'top-left'
  | 'top-center'
  | 'top-right';

/**
 * The label templates on offer. `{n}` is the running number and `{total}` the last number that
 * will be printed — see `labelFor`. Deliberately a fixed set rather than free text: free text
 * in a font that cannot draw most of the world's alphabets is a trap, and the three below are
 * what page numbering actually needs.
 */
export const NUMBER_FORMATS = {
  plain: '{n}',
  'of-total': '{n} / {total}',
  'page-n': 'Page {n}',
} as const;

export type NumberFormatId = keyof typeof NUMBER_FORMATS;

export type AddPageNumbersOptions = {
  position: NumberPosition;
  format: NumberFormatId;
  /** The number printed on the first numbered page. */
  startAt: number;
  /** Pages to number, one-based, e.g. "3-12". Empty means every page. */
  range: string;
  fontSize: number;
  /** Distance from the edge of the page, in points. */
  margin: number;
};

export type AddPageNumbersResult = {
  blob: Blob;
  /** Pages in the document — unchanged by this operation. */
  pages: number;
  /** How many of them got a number. */
  numbered: number;
  firstLabel: string;
  lastLabel: string;
};

export class PageNumberError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'PageNumberError';
  }
}

/**
 * Render one label.
 *
 * `{total}` is the LAST number that will be printed, not the document's page count. Numbering
 * pages 5-12 starting from 1 reads "1 / 8" through "8 / 8", which is what a reader of those
 * eight pages expects; "1 / 12" would refer to a numbering that does not appear anywhere.
 * For the ordinary case — every page, starting at 1 — the two definitions coincide.
 */
export function labelFor(format: NumberFormatId, n: number, total: number): string {
  return NUMBER_FORMATS[format].replace('{n}', String(n)).replace('{total}', String(total));
}

/**
 * Where the label's baseline starts, in the page as the reader sees it.
 *
 * Pure and exported so the placement can be tested without a PDF. `textWidth` and `ascent` come
 * from the font at the chosen size; both are needed because PDF positions text by the left end
 * of its baseline, so right-aligning means subtracting the width and top-aligning means
 * subtracting the ascent.
 */
export function labelOrigin(
  position: NumberPosition,
  frame: { width: number; height: number },
  margin: number,
  textWidth: number,
  ascent: number,
): { x: number; y: number } {
  const [vertical, horizontal] = position.split('-') as ['bottom' | 'top', string];
  const x =
    horizontal === 'left'
      ? margin
      : horizontal === 'right'
        ? frame.width - margin - textWidth
        : (frame.width - textWidth) / 2;
  const y = vertical === 'bottom' ? margin : frame.height - margin - ascent;
  return { x, y };
}

/**
 * Open a document, turning pdf-lib's internal messages into ones that name the file and say
 * what to do. Encrypted files are refused rather than loaded with `ignoreEncryption`: stripping
 * someone's restrictions in order to stamp a number on the result is not what they asked for.
 */
async function loadDoc(file: File) {
  const { PDFDocument } = await import('pdf-lib');
  try {
    return await PDFDocument.load(await file.arrayBuffer());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/encrypt/i.test(msg)) {
      throw new PageNumberError(
        'pdfPasswordProtected',
        `"${file.name}" is password-protected. Remove the password and try again.`,
        { name: file.name },
      );
    }
    throw new PageNumberError('pdfUnreadable', `"${file.name}" could not be read as a PDF.`, {
      name: file.name,
    });
  }
}

/** Page count, so the range field can say what is valid before the user submits. */
export async function readPageCount(file: File): Promise<number> {
  return (await loadDoc(file)).getPageCount();
}

/** Stamp page numbers onto an existing document. Page count and page order are untouched. */
export async function addPageNumbers(
  file: File,
  opts: AddPageNumbersOptions,
): Promise<AddPageNumbersResult> {
  // Whole numbers only. A fractional start was accepted before and printed "1.5", "2.5", "3.5"
  // — a page numbering nobody asked for, from a spinner the browser lets you type into.
  if (!Number.isInteger(opts.startAt) || opts.startAt < 0) {
    throw new PageNumberError(
      'startAtNotWhole',
      'The starting number must be a whole number, zero or more.',
    );
  }
  if (!(opts.fontSize > 0)) {
    throw new PageNumberError('fontSizeAboveZero', 'Choose a font size above zero.');
  }

  const { StandardFonts, degrees, rgb } = await import('pdf-lib');
  const doc = await loadDoc(file);
  const pageCount = doc.getPageCount();
  // parsePageRange throws PageRangeError with its own readable message; let it through rather
  // than flattening it into a generic one.
  const targets = opts.range.trim()
    ? parsePageRange(opts.range, { pageCount })
    : Array.from({ length: pageCount }, (_, i) => i);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ascent = font.heightAtSize(opts.fontSize, { descender: false });
  const lastNumber = opts.startAt + targets.length - 1;

  let firstLabel = '';
  let lastLabel = '';

  targets.forEach((index, position) => {
    const page = doc.getPage(index);
    // getCropBox, not getWidth/getHeight: the crop box is what the reader displays, and both it
    // and the media box can start somewhere other than (0, 0). See shared/pdf-page-stamp.ts.
    const frame = pageFrame(page.getCropBox(), page.getRotation().angle);
    const text = labelFor(opts.format, opts.startAt + position, lastNumber);
    if (position === 0) firstLabel = text;
    lastLabel = text;

    try {
      const width = font.widthOfTextAtSize(text, opts.fontSize);
      const origin = labelOrigin(opts.position, frame, opts.margin, width, ascent);
      const { x, y } = frame.toUserSpace(origin.x, origin.y);
      page.drawText(text, {
        x,
        y,
        size: opts.fontSize,
        font,
        color: rgb(0, 0, 0),
        // Without this the number sits in whatever corner the media box calls "bottom right"
        // and reads sideways on any page the reader turns.
        rotate: degrees(frame.toUserAngle(0)),
      });
    } catch (e) {
      rethrowAsTextError(e, `The page number "${text}"`, { label: text });
    }
  });

  const bytes = await doc.save();
  return {
    // Copy into a fresh ArrayBuffer: pdf-lib returns a view over a pooled buffer, and handing
    // that straight to Blob can capture more than the document's own bytes.
    blob: new Blob([bytes.slice()], { type: 'application/pdf' }),
    pages: pageCount,
    numbered: targets.length,
    firstLabel,
    lastLabel,
  };
}
