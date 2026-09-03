/**
 * Write an invisible text layer onto the ORIGINAL pages of a PDF — a "searchable PDF".
 *
 * The scan itself is left untouched: this only adds text drawn at `opacity: 0` over each word
 * tesseract found, so the document looks identical, Ctrl+F finds words, and selecting a line
 * copies it. Stirling-PDF and every other tool that offers this runs OCRmyPDF on a server;
 * doing it in the tab is the whole point of the tool.
 *
 * TWO COORDINATE SYSTEMS MEET HERE, and getting either wrong puts the text somewhere plausible
 * but wrong, which is invisible by construction:
 *
 *   - Tesseract boxes are pixels in the image we rendered, origin TOP-left, y downwards.
 *   - pdf-lib draws in points, origin BOTTOM-left, y upwards, and knows nothing about `/Rotate`.
 *
 * The scale factor is derived from the rendered image's own width rather than from the DPI the
 * caller asked for: a very large page is rasterised at a reduced scale to stay under the canvas
 * ceiling, and hard-coding 72/200 would then place every word on the wrong part of the page.
 * `/Rotate` is handled by the shared pageFrame mapping, the same one the stamping tools use.
 */

import { type PageFrame, pageFrame } from '../shared/pdf-page-stamp';
import type { OcrBox, OcrLanguage } from '../shared/tesseract-loader';

export const NOTO_FONT_URL = '/third-party/noto/NotoSans-Regular.ttf';

/**
 * Words below this are usually noise — speckles read as punctuation — and putting them in the
 * layer makes selecting a line copy junk between the real words. 30 is deliberately low: a
 * genuinely hard scan still lands in the 40s, so this drops rubbish and not weak text.
 */
export const MIN_LAYER_CONFIDENCE = 30;

export type LayerWord = { text: string; confidence: number; bbox: OcrBox };

export type PageLayer = {
  /** Zero-based, matching pdf-lib's getPage. */
  pageIndex: number;
  words: LayerWord[];
  /** Size of the image the boxes came from, after any downscale. */
  imageWidth: number;
  imageHeight: number;
};

export type Placement = { x: number; y: number; size: number };

/**
 * One word box to a position in the page's VISIBLE frame (bottom-left origin).
 *
 * The baseline is taken as the bottom of the ink box. Tesseract does report a per-line baseline,
 * but a word's own box bottom is within a point of it at these sizes and needs no interpolation
 * along the line. Descenders make the drawn text sit a hair low on words like "page"; that
 * shifts a selection highlight, never what Ctrl+F matches.
 */
export function placeWord(bbox: OcrBox, pointsPerPixel: number, frameHeight: number): Placement {
  return {
    x: bbox.x0 * pointsPerPixel,
    y: frameHeight - bbox.y1 * pointsPerPixel,
    size: Math.max(1, (bbox.y1 - bbox.y0) * pointsPerPixel),
  };
}

/** Points per rendered pixel for one page. Derived, never assumed — see the file header. */
export function pointsPerPixel(frame: PageFrame, imageWidth: number): number {
  if (!(imageWidth > 0)) return 0;
  return frame.width / imageWidth;
}

/** Vietnamese needs a Unicode font; the other three staged languages fit WinAnsi. */
export function needsUnicodeFont(lang: OcrLanguage): boolean {
  return lang === 'vie';
}

export type SearchableResult = {
  blob: Blob;
  /** Words whose characters no available font could encode. Reported, never swallowed. */
  skipped: number;
};

/**
 * Load the Unicode font used for languages Helvetica cannot spell.
 *
 * Served from this origin (manifest key `noto`), never from Google Fonts — the request would
 * otherwise tell a third party that someone is OCRing a Vietnamese document. Subsetting is left
 * to pdf-lib, so the 421 KB file adds only the glyphs actually used to the output.
 */
async function loadUnicodeFont(): Promise<ArrayBuffer> {
  const res = await fetch(NOTO_FONT_URL);
  if (!res.ok) throw new Error(`Font could not be loaded (${res.status}).`);
  return res.arrayBuffer();
}

export async function buildSearchablePdf(
  file: File,
  layers: PageLayer[],
  lang: OcrLanguage,
): Promise<SearchableResult> {
  const { PDFDocument, StandardFonts, degrees } = await import('pdf-lib');
  const doc = await PDFDocument.load(await file.arrayBuffer());

  let font: Awaited<ReturnType<typeof doc.embedFont>>;
  if (needsUnicodeFont(lang)) {
    const fontkit = (await import('@pdf-lib/fontkit')).default;
    doc.registerFontkit(fontkit);
    font = await doc.embedFont(await loadUnicodeFont(), { subset: true });
  } else {
    font = await doc.embedFont(StandardFonts.Helvetica);
  }

  let skipped = 0;
  for (const layer of layers) {
    const page = doc.getPage(layer.pageIndex);
    const frame = pageFrame(page.getCropBox(), page.getRotation().angle);
    const scale = pointsPerPixel(frame, layer.imageWidth);
    if (scale <= 0) continue;
    // The layer is drawn in the frame the reader sees, so a page stored sideways gets its text
    // rotated with it rather than lying across the image.
    const rotate = degrees(frame.toUserAngle(0));

    for (const word of layer.words) {
      const text = word.text.trim();
      if (!text || word.confidence < MIN_LAYER_CONFIDENCE) continue;
      const { x, y, size } = placeWord(word.bbox, scale, frame.height);
      const point = frame.toUserSpace(x, y);
      try {
        page.drawText(text, { x: point.x, y: point.y, size, font, opacity: 0, rotate });
      } catch {
        // A character the font cannot encode. One word missing from the search index is a far
        // better outcome than the whole export failing, but the count is surfaced to the user.
        skipped += 1;
      }
    }
  }

  const bytes = await doc.save();
  // Copy out of pdf-lib's pooled buffer before handing it to Blob — see watermark-pdf.
  return { blob: new Blob([bytes.slice()], { type: 'application/pdf' }), skipped };
}
