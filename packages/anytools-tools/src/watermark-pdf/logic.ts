// pdf-lib is imported dynamically inside the function, never at module top level — same reason
// as merge-pdf: a top-level import pulls ~173 KB gzipped into anything that touches this module.
import { type EmbeddableImage, ownBuffer } from '../shared/embeddable-image';
import { parsePageRange } from '../shared/page-range';
import { assertDrawableText, pageFrame, rethrowAsTextError } from '../shared/pdf-page-stamp';
import { embedTextFont } from '../shared/pdf-unicode-font';
import { ToolError } from '../shared/tool-error';

export type WatermarkTextOptions = {
  kind: 'text';
  text: string;
  fontSize: number;
  color: string;
};

export type WatermarkImageOptions = {
  kind: 'image';
  image: EmbeddableImage;
  /** Width as a percentage of the page's visible width. */
  scalePercent: number;
};

export type WatermarkOptions = (WatermarkTextOptions | WatermarkImageOptions) & {
  /** Degrees anticlockwise as the reader sees it. 45 is the diagonal everyone expects. */
  rotation: number;
  /** 0 (invisible) to 1 (opaque). */
  opacity: number;
  /** Pages to stamp, one-based. Empty means every page. */
  range: string;
};

export type WatermarkResult = {
  blob: Blob;
  pages: number;
  /** How many pages were stamped. */
  stamped: number;
};

export class WatermarkError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'WatermarkError';
  }
}

/**
 * `#rgb` or `#rrggbb` to the 0-1 components pdf-lib's `rgb()` takes.
 *
 * Rejects rather than falling back to black: a colour that silently became black would be
 * blamed on the watermark being "too dark", not on the input.
 */
export function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    throw new WatermarkError(
      'badColour',
      `"${hex}" is not a colour. Use a hex value such as #808080.`,
      { hex },
    );
  }
  const digits = m[1] as string;
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((c) => c + c)
          .join('')
      : digits;
  return {
    r: Number.parseInt(full.slice(0, 2), 16) / 255,
    g: Number.parseInt(full.slice(2, 4), 16) / 255,
    b: Number.parseInt(full.slice(4, 6), 16) / 255,
  };
}

/**
 * The anchor that centres a rotated box on `center`.
 *
 * pdf-lib's `drawText` and `drawImage` take the box's BOTTOM-LEFT corner and rotate the box
 * about that same corner. Centring therefore means walking back from the centre by half the
 * box along its own rotated axes — half the width along the text direction, half the height
 * along the perpendicular. Passing the centre directly (the obvious mistake) puts a 45-degree
 * watermark hanging off the top-right of the page.
 */
export function centeredAnchor(
  center: { x: number; y: number },
  width: number,
  height: number,
  angleDegrees: number,
): { x: number; y: number } {
  const a = (angleDegrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return {
    x: center.x - (width / 2) * cos + (height / 2) * sin,
    y: center.y - (width / 2) * sin - (height / 2) * cos,
  };
}

async function loadDoc(file: File) {
  const { PDFDocument } = await import('pdf-lib');
  try {
    return await PDFDocument.load(await file.arrayBuffer());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/encrypt/i.test(msg)) {
      throw new WatermarkError(
        'pdfPasswordProtected',
        `"${file.name}" is password-protected. Remove the password and try again.`,
        { name: file.name },
      );
    }
    throw new WatermarkError('pdfUnreadable', `"${file.name}" could not be read as a PDF.`, {
      name: file.name,
    });
  }
}

/** Page count, so the range field can say what is valid before the user submits. */
export async function readPageCount(file: File): Promise<number> {
  return (await loadDoc(file)).getPageCount();
}

/** Stamp a mark across the centre of every selected page. */
export async function watermarkPdf(file: File, opts: WatermarkOptions): Promise<WatermarkResult> {
  if (opts.kind === 'text' && !opts.text.trim()) {
    throw new WatermarkError('watermarkTextEmpty', 'Type the text you want stamped on the pages.');
  }
  if (opts.kind === 'text' && !(opts.fontSize > 0)) {
    throw new WatermarkError('fontSizeAboveZero', 'Choose a font size above zero.');
  }
  if (opts.kind === 'image' && !(opts.scalePercent > 0)) {
    throw new WatermarkError('sizeAboveZero', 'Choose a size above zero.');
  }
  if (!(opts.opacity > 0 && opts.opacity <= 1)) {
    throw new WatermarkError('opacityRange', 'Opacity must be above 0 and at most 1.');
  }

  const { degrees, rgb } = await import('pdf-lib');
  // Before reading the file, which may be hundreds of megabytes: can the built-in font draw
  // this at all? The failure is the same either way, but it arrives now instead of after the
  // load and save. Colours are parsed up front for the same reason.
  if (opts.kind === 'text') {
    await assertDrawableText(opts.text, 'The watermark text');
    parseHexColor(opts.color);
  }
  const doc = await loadDoc(file);
  const pageCount = doc.getPageCount();
  const targets = opts.range.trim()
    ? parsePageRange(opts.range, { pageCount })
    : Array.from({ length: pageCount }, (_, i) => i);

  // Both the font and the image are embedded ONCE and referenced from every page. Embedding
  // per page would multiply a 200 KB logo by the page count. Helvetica when it can spell the
  // text; the staged Noto Sans (subset) for Vietnamese, Greek, Cyrillic.
  const font =
    opts.kind === 'text' ? await embedTextFont(doc, opts.text, 'The watermark text') : null;
  const color = opts.kind === 'text' ? parseHexColor(opts.color) : null;
  let image: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
  if (opts.kind === 'image') {
    const bytes = ownBuffer(opts.image.bytes);
    try {
      image = opts.image.format === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    } catch {
      throw new WatermarkError(
        'imageEmbedFailed',
        `"${opts.image.name}" could not be embedded as an image.`,
        { name: opts.image.name },
      );
    }
  }

  for (const index of targets) {
    const page = doc.getPage(index);
    // getCropBox, not getWidth/getHeight: the crop box is what the reader displays, and both it
    // and the media box can start somewhere other than (0, 0). See shared/pdf-page-stamp.ts.
    const frame = pageFrame(page.getCropBox(), page.getRotation().angle);
    const center = { x: frame.width / 2, y: frame.height / 2 };
    const userAngle = frame.toUserAngle(opts.rotation);

    if (opts.kind === 'text' && font && color) {
      try {
        const width = font.widthOfTextAtSize(opts.text, opts.fontSize);
        const height = font.heightAtSize(opts.fontSize, { descender: false });
        const anchor = centeredAnchor(center, width, height, opts.rotation);
        const { x, y } = frame.toUserSpace(anchor.x, anchor.y);
        page.drawText(opts.text, {
          x,
          y,
          size: opts.fontSize,
          font,
          color: rgb(color.r, color.g, color.b),
          opacity: opts.opacity,
          rotate: degrees(userAngle),
        });
      } catch (e) {
        rethrowAsTextError(e, 'The watermark text');
      }
    } else if (opts.kind === 'image' && image) {
      // Percentage of the width the READER sees, so a page stored sideways is stamped at the
      // size it looks, not the size its media box happens to be.
      const width = (frame.width * opts.scalePercent) / 100;
      const height = (width * image.height) / image.width;
      const anchor = centeredAnchor(center, width, height, opts.rotation);
      const { x, y } = frame.toUserSpace(anchor.x, anchor.y);
      page.drawImage(image, {
        x,
        y,
        width,
        height,
        opacity: opts.opacity,
        rotate: degrees(userAngle),
      });
    }
  }

  const bytes = await doc.save();
  return {
    // Copy into a fresh ArrayBuffer: pdf-lib returns a view over a pooled buffer, and handing
    // that straight to Blob can capture more than the document's own bytes.
    blob: new Blob([bytes.slice()], { type: 'application/pdf' }),
    pages: pageCount,
    stamped: targets.length,
  };
}
