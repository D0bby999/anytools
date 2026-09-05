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
import { NOTO_FONT_URL, UnicodeFontError, loadUnicodeFont } from '../shared/pdf-unicode-font';
import type { OcrBox, OcrLanguage } from '../shared/tesseract-loader';
import { ToolError } from '../shared/tool-error';

export { NOTO_FONT_URL };

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
  /** Words whose characters the embedded font could not draw. Reported, never swallowed. */
  skipped: number;
};

/** Everything expensive is already done: hand it the layers and get the file. */
export type SearchableBuilder = (layers: PageLayer[]) => Promise<SearchableResult>;

/** Nothing in the searchable step is worth losing the recognised text over. Say what failed. */
export class SearchableLayerError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'SearchableLayerError';
  }
}

/** The shared loader, with its failure re-labelled for this tool's UI. */
async function loadLayerFont(): Promise<ArrayBuffer> {
  try {
    return await loadUnicodeFont();
  } catch (e) {
    if (e instanceof UnicodeFontError) {
      throw new SearchableLayerError(
        e.code === 'unicodeFontHttp' ? 'layerFontHttp' : 'layerFontFetch',
        e.message.replace('this text needs', 'the searchable layer needs'),
        e.params,
      );
    }
    throw e;
  }
}

/**
 * Can this font actually draw this word?
 *
 * `page.drawText` throws for a standard font asked for a character outside WinAnsi, which is how
 * the skipped count used to be produced. An embedded Unicode font does NOT throw: fontkit maps
 * anything it has no glyph for onto `.notdef` and carries on, so a CJK stamp or a stray arrow
 * that OCR read out of a Vietnamese scan went into the layer as a blank the reader can never
 * match, counted as a success. Asking the font's own character set first catches both cases.
 *
 * Measured against the staged NotoSans-Regular.ttf: `getCharacterSet()` is 2,965 code points,
 * `encodeText('漢字')` returns glyph 0 twice without complaint, and `drawText` does not throw.
 */
export function canDrawWord(charset: Set<number>, text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined || !charset.has(code)) return false;
  }
  return true;
}

/**
 * Open the original and embed the font — everything that can fail before a page is read.
 *
 * Deliberately done BEFORE the OCR loop. Both failures here are properties of the file and the
 * environment, known in the first second: pdf.js opens a permission-encrypted scan quite happily
 * and pdf-lib refuses it, and the font is one fetch that a stale service worker or a bad deploy
 * can 404. Discovering either after four minutes of recognition — and throwing the recognised
 * text away with it — was the behaviour this replaces.
 *
 * The original is NOT loaded with `ignoreEncryption`: pdf-lib does not decrypt, it only skips
 * the check, so the "searchable PDF" that came out would have unreadable page content. Refusing
 * with an explanation is the honest answer, and the .txt is unaffected either way.
 */
export async function prepareSearchableLayer(
  file: File,
  lang: OcrLanguage,
): Promise<SearchableBuilder> {
  const { PDFDocument, StandardFonts, degrees } = await import('pdf-lib');

  let doc: Awaited<ReturnType<typeof PDFDocument.load>>;
  try {
    doc = await PDFDocument.load(await file.arrayBuffer());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const name = file.name;
    throw /encrypt/i.test(msg)
      ? new SearchableLayerError(
          'layerPdfPasswordProtected',
          `"${name}" is password-protected, so a text layer cannot be written into it. Remove the password, or turn the searchable-PDF option off to get the text on its own.`,
          { name },
        )
      : new SearchableLayerError(
          'layerPdfUnreadable',
          `"${name}" could not be re-opened to write the text layer into. Turn the searchable-PDF option off to get the text on its own.`,
          { name },
        );
  }

  let font: Awaited<ReturnType<typeof doc.embedFont>>;
  if (needsUnicodeFont(lang)) {
    const fontkit = (await import('@pdf-lib/fontkit')).default;
    doc.registerFontkit(fontkit);
    font = await doc.embedFont(await loadLayerFont(), { subset: true });
  } else {
    font = await doc.embedFont(StandardFonts.Helvetica);
  }
  // Once: for Noto this is ~3,000 code points, and the alternative is rebuilding it per word.
  const charset = new Set(font.getCharacterSet());

  return async (layers) => {
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
        if (!canDrawWord(charset, text)) {
          skipped += 1;
          continue;
        }
        const { x, y, size } = placeWord(word.bbox, scale, frame.height);
        const point = frame.toUserSpace(x, y);
        try {
          page.drawText(text, { x: point.x, y: point.y, size, font, opacity: 0, rotate });
        } catch {
          // Belt and braces for anything the character set did not predict. One word missing
          // from the search index beats failing the whole export, and the count is surfaced.
          skipped += 1;
        }
      }
    }

    const bytes = await doc.save();
    // Copy out of pdf-lib's pooled buffer before handing it to Blob — see watermark-pdf.
    return { blob: new Blob([bytes.slice()], { type: 'application/pdf' }), skipped };
  };
}
