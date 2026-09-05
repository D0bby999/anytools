/**
 * Text fonts for drawing ONTO a PDF, shared by watermark-pdf and the OCR searchable layer.
 *
 * pdf-lib's built-in Helvetica covers WinAnsi — Western Latin only. On a site with a Vietnamese
 * edition that meant "BẢN NHÁP" was refused as a watermark. Noto Sans is already staged for the
 * OCR layer (manifest key `noto`, served from this origin, never from Google Fonts), and it
 * covers Vietnamese, Greek and Cyrillic as well. So: Helvetica when it can spell the text, Noto
 * Sans otherwise, and a message naming the characters when neither can.
 */
import type { PDFDocument, PDFFont } from 'pdf-lib';
import { ToolError } from './tool-error';

export const NOTO_FONT_URL = '/third-party/noto/NotoSans-Regular.ttf';

export class UnicodeFontError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'UnicodeFontError';
  }
}

export class PdfTextError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'PdfTextError';
  }
}

/** Fetch the staged Noto Sans. Subsetting is left to pdf-lib, so only the used glyphs are embedded. */
export async function loadUnicodeFont(): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(NOTO_FONT_URL);
  } catch {
    throw new UnicodeFontError(
      'unicodeFontFetch',
      'The Unicode font this text needs could not be loaded. Check your connection and try again.',
    );
  }
  if (!res.ok) {
    throw new UnicodeFontError(
      'unicodeFontHttp',
      `The Unicode font this text needs could not be loaded (HTTP ${res.status}).`,
      { status: res.status },
    );
  }
  return res.arrayBuffer();
}

/**
 * The characters of `text` a font has no glyph for, de-duplicated, in order of appearance.
 *
 * Asked of the font's own character set rather than of `encodeText`: an embedded font does not
 * throw for a missing glyph, it maps the character to `.notdef` and draws a box.
 */
export function undrawableChars(charset: Set<number>, text: string): string[] {
  const out: string[] = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code !== undefined && !charset.has(code) && !out.includes(char)) out.push(char);
  }
  return out;
}

export function coverageMessage(subject: string, missing: string[]): string {
  return `${subject} uses characters no available font can draw: ${missing.join(' ')}. Latin characters (including Vietnamese), Greek and Cyrillic are covered; Chinese, Japanese, Korean, Arabic and emoji are not.`;
}

/** The error `embedTextFont` throws for text with characters no available font can draw. */
export function coverageError(subject: string, missing: string[]): PdfTextError {
  return new PdfTextError('fontCoverage', coverageMessage(subject, missing), {
    subject,
    missing: missing.join(' '),
  });
}

/**
 * Embed the font that can draw `text` into `doc`.
 *
 * Helvetica first: it is built into every reader, adds nothing to the file, and covers most
 * Western text. Only when it cannot encode the text is the 421 KB Noto Sans fetched and
 * embedded as a subset. `subject` names the text in the error ("The watermark text").
 */
export async function embedTextFont(
  doc: PDFDocument,
  text: string,
  subject: string,
): Promise<PDFFont> {
  const { StandardFonts } = await import('pdf-lib');
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  try {
    helvetica.encodeText(text);
    return helvetica;
  } catch {
    // Fall through to the Unicode font.
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await loadUnicodeFont();
  } catch (e) {
    const detail = e instanceof Error ? e.message : '';
    throw new PdfTextError(
      'unicodeFontNeeded',
      `${subject} needs the Unicode font, which could not be loaded. ${detail}`.trim(),
      { subject, detail },
    );
  }
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  doc.registerFontkit(fontkit);
  const noto = await doc.embedFont(bytes, { subset: true });
  const missing = undrawableChars(new Set(noto.getCharacterSet()), text);
  if (missing.length > 0) throw coverageError(subject, missing);
  return noto;
}
