import { parsePageRange } from '../shared/page-range';
import { PdfRenderError, openPdf } from '../shared/pdfjs-loader';
import {
  type OcrLanguage,
  type OcrProgress,
  beginOcrRun,
  ensureRunLive,
  prepareForOcr,
  recognize,
} from '../shared/tesseract-loader';
import { type PageLayer, type SearchableBuilder, prepareSearchableLayer } from './searchable-layer';

/**
 * 200 DPI. Tesseract's models were trained around 300 DPI for 10pt type, but a scan is usually
 * already 200-300 and rendering higher than the source adds pixels, not information — it only
 * makes recognition slower. 200 is the point where accuracy stops improving on ordinary
 * documents and is what OCRmyPDF's own guidance recommends as a floor.
 */
export const OCR_DPI = 200;

/** Same Safari ceiling the image tools respect; a page above it is rendered at reduced scale. */
const MAX_CANVAS_PIXELS = 16_777_216;

export type OcrPdfOptions = {
  lang: OcrLanguage;
  /** One-based pages, e.g. "1-3, 7". Empty means every page. */
  range: string;
  searchable: boolean;
};

export type OcrPdfPage = {
  pageNumber: number;
  text: string;
  confidence: number;
  words: number;
};

export type OcrPdfResult = {
  pages: OcrPdfPage[];
  /** The .txt body, page markers included. */
  text: string;
  /** Word-weighted mean confidence across the pages that were read. */
  confidence: number;
  pdf: Blob | null;
  /** Words the invisible layer could not encode. Zero unless a font ran out of glyphs. */
  skipped: number;
  /** Set when the searchable PDF failed but the text survived. Never hides the text. */
  searchableError: string | null;
  /** Code for the sentence above (`searchableFailed`), so the UI can localize it. */
  searchableErrorCode: string | null;
  /** What the searchable step threw, for the UI to localize the reason after the sentence. */
  searchableCause: unknown;
};

/** What the optional searchable-PDF step produced, however it ended. */
export type SearchableOutcome = Pick<
  OcrPdfResult,
  'pdf' | 'skipped' | 'searchableError' | 'searchableErrorCode' | 'searchableCause'
>;

/** The sentence a failed searchable step is reported with; the cause follows it. */
export const SEARCHABLE_FAILED =
  'The text below is complete, but the searchable PDF could not be built.';

export type OcrPdfProgress = {
  pageNumber: number;
  done: number;
  total: number;
  stage: OcrProgress;
};

/** `--- Page 3 ---` before each page, so a 40-page .txt is still navigable. */
export function formatPagesText(pages: OcrPdfPage[]): string {
  return pages.map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`).join('\n\n');
}

/** Word-weighted, so a mostly-blank page does not swing the number. See ocr-image-to-text. */
export function meanPageConfidence(pages: OcrPdfPage[]): number {
  const scored = pages.filter((p) => p.words > 0);
  const total = scored.reduce((sum, p) => sum + p.words, 0);
  if (total === 0) return 0;
  return scored.reduce((sum, p) => sum + p.confidence * p.words, 0) / total;
}

/** `report.pdf` becomes `report-ocr.txt` / `report-searchable.pdf`. */
export function outputName(fileName: string, suffix: string, extension: string): string {
  return `${fileName.replace(/\.pdf$/i, '')}-${suffix}.${extension}`;
}

/**
 * Render scale for one page: the requested DPI, reduced if that would exceed the canvas ceiling.
 *
 * Reducing beats throwing. A page big enough to hit the ceiling is a poster or a plan, where
 * 200 DPI is far more resolution than its lettering needs; refusing to read it at all would be
 * the worse answer, and every box is mapped back through the image's real width anyway.
 */
export function renderScale(widthPt: number, heightPt: number, dpi: number): number {
  const wanted = dpi / 72;
  const pixels = widthPt * wanted * heightPt * wanted;
  if (pixels <= MAX_CANVAS_PIXELS) return wanted;
  return wanted * Math.sqrt(MAX_CANVAS_PIXELS / pixels);
}

/**
 * Assemble the result, running the optional searchable-PDF step without ever risking the text.
 *
 * Minutes of recognition are already spent by the time this is called. A failure in the layer —
 * a document pdf-lib chokes on while saving, a page index the original does not have, memory —
 * used to propagate out of `ocrPdf` and take every recognised page with it. The user gets the
 * .txt and a sentence saying what went wrong instead.
 */
export async function finishOcrPdf(
  pages: OcrPdfPage[],
  build: SearchableBuilder | null,
  layers: PageLayer[],
): Promise<OcrPdfResult> {
  let outcome: SearchableOutcome = {
    pdf: null,
    skipped: 0,
    searchableError: null,
    searchableErrorCode: null,
    searchableCause: null,
  };
  if (build) {
    try {
      const { blob, skipped } = await build(layers);
      outcome = { ...outcome, pdf: blob, skipped };
    } catch (e) {
      const why = e instanceof Error && e.message ? ` ${e.message}` : '';
      outcome = {
        pdf: null,
        skipped: 0,
        searchableError: `${SEARCHABLE_FAILED}${why}`,
        searchableErrorCode: 'searchableFailed',
        searchableCause: e,
      };
    }
  }
  return {
    pages,
    text: formatPagesText(pages),
    confidence: meanPageConfidence(pages),
    ...outcome,
  };
}

/**
 * Read a scanned PDF, page by page.
 *
 * Sequential: one tesseract worker, one page at a time, and the whole pipeline is memory-heavy
 * enough (a 200-DPI A4 canvas is ~15 MB of pixels) that overlapping pages would risk the tab
 * rather than save time.
 */
export async function ocrPdf(
  file: File,
  opts: OcrPdfOptions,
  onProgress?: (p: OcrPdfProgress) => void,
): Promise<OcrPdfResult> {
  // Before anything expensive: if the original cannot take a text layer, say so now rather than
  // after the last page. Throwing here costs the user nothing — no page has been read yet.
  const build = opts.searchable ? await prepareSearchableLayer(file, opts.lang) : null;

  const run = beginOcrRun();
  const doc = await openPdf(file);
  const pages: OcrPdfPage[] = [];
  const layers: PageLayer[] = [];

  try {
    const indices = opts.range.trim()
      ? parsePageRange(opts.range, { pageCount: doc.numPages })
      : Array.from({ length: doc.numPages }, (_, i) => i);

    for (const [done, index] of indices.entries()) {
      // Stop pressed between pages, or while the previous page was rendering, rejects no job —
      // only this check ends the run instead of letting it start the next page's worker.
      ensureRunLive(run);
      const page = await doc.getPage(index + 1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({
        scale: renderScale(base.width, base.height, OCR_DPI),
      });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new PdfRenderError(
          'noCanvasContext',
          'Your browser did not provide a 2D canvas context.',
        );
      }
      // OCR of a transparent canvas reads black-on-black. Scans have no alpha, but a page whose
      // content does not cover the media box leaves the rest transparent.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;

      const prepared = prepareForOcr(canvas, canvas.width, canvas.height);
      // The rendered page is now redundant — the grayscale copy is what tesseract reads. Zeroing
      // it hands ~15 MB per A4 page back at once instead of at the collector's convenience,
      // which on a 50-page scan is the difference between steady memory and a growing tab.
      canvas.width = 0;
      canvas.height = 0;
      const result = await recognize(run, opts.lang, prepared, (stage) =>
        onProgress?.({ pageNumber: index + 1, done, total: indices.length, stage }),
      );
      prepared.width = 0;
      prepared.height = 0;
      page.cleanup();

      const words = result.blocks.flatMap((b) => b.lines.flatMap((l) => l.words));
      pages.push({
        pageNumber: index + 1,
        text: result.text.trim(),
        confidence: result.confidence,
        words: words.length,
      });
      layers.push({
        pageIndex: index,
        words,
        imageWidth: result.width,
        imageHeight: result.height,
      });
    }
  } finally {
    await doc.destroy();
  }

  return finishOcrPdf(pages, build, layers);
}
