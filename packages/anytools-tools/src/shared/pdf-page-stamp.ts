/**
 * Helpers for drawing something ONTO an existing PDF page. Shared by add-page-numbers and
 * watermark-pdf, which are the same operation with different marks.
 *
 * Two things stand between "the reader sees a page" and "pdf-lib draws at (x, y)".
 *
 * `/Rotate`. A PDF page has a box in user space and, separately, a rotation the reader applies
 * before showing it. pdf-lib draws in user space and knows nothing about that rotation, so on a
 * page scanned sideways — `/Rotate 90`, extremely common, and what fixtures/text-3p.pdf page 2
 * carries — a page number placed at "bottom right of the box" appears rotated 90 degrees in a
 * different corner entirely.
 *
 * The BOX ORIGIN. `page.getWidth()`/`getHeight()` (and `getSize()`) return the media box's
 * extent and throw its lower-left corner away, and they never look at the CropBox. Neither
 * assumption holds in the wild: imposed and trimmed pages carry boxes like [100 200 695 1042],
 * and the CropBox — not the MediaBox — is what a reader displays. Taking width and height alone
 * put a "36 pt from the bottom-left" label at user (36, 36), which on those pages is off the
 * sheet, or inside the media box but outside the visible crop. Nothing throws; the mark is just
 * missing. So this module takes the whole box and maps through its origin.
 *
 * Every position control on both tools is meaningless without this mapping, so it lives here
 * with its derivation and its own tests rather than being re-derived twice.
 */

export type Rotation = 0 | 90 | 180 | 270;

/**
 * A page box: lower-left corner plus extent, exactly what pdf-lib's `getCropBox()` and
 * `getMediaBox()` return. Callers should pass `page.getCropBox()`, which already falls back to
 * the media box when the page has no CropBox.
 */
export type PageBox = { x: number; y: number; width: number; height: number };

export type PageFrame = {
  /** Page width as the READER sees it — the box swapped when rotated a quarter turn. */
  width: number;
  /** Page height as the reader sees it. */
  height: number;
  rotation: Rotation;
  /**
   * Map a point in the visible frame (origin bottom-left, y upwards) to pdf-lib user space.
   */
  toUserSpace(x: number, y: number): { x: number; y: number };
  /** The user-space text angle that appears as `degrees` to the reader. */
  toUserAngle(degrees: number): number;
};

/** Round to the nearest quarter turn and normalise into 0/90/180/270. */
export function normalizeRotation(degrees: number): Rotation {
  const r = ((((Math.round(degrees / 90) * 90) % 360) + 360) % 360) as Rotation;
  return r;
}

/**
 * Build the mapping for one page from its visible box (`page.getCropBox()`) and its `/Rotate`.
 *
 * Work box-relative first, then translate by the box's lower-left corner (bx, by) — the two
 * effects are independent, and folding the origin into the rotation formulae is where sign
 * errors come from.
 *
 * Derivation, box-relative, for `/Rotate 90` (the reader turns the sheet a quarter turn
 * CLOCKWISE). A clockwise quarter turn sends (x, y) to (y, -x); the box is w by h, so the second
 * coordinate lands in [-w, 0] and w is added to bring it back. Hence a box-relative point
 * appears at visible (y, w - x), and inverting gives x = w - vy, y = vx. Checking one corner by
 * hand: box-relative (0, 0) is the bottom-left of the sheet, and after turning the sheet
 * clockwise the bottom-left corner is at the TOP-left, which is visible (0, w). The formula
 * agrees. Adding the origin gives the four cases below:
 *
 *     /Rotate 0   → (bx + x,         by + y)
 *     /Rotate 90  → (bx + w - y,     by + x)
 *     /Rotate 180 → (bx + w - x,     by + h - y)
 *     /Rotate 270 → (bx + y,         by + h - x)
 *
 * where w and h are the BOX's own width and height, not the visible ones — those two swap on a
 * quarter turn, and using the swapped pair is the same bug in a new place.
 *
 * For the angle: box-relative direction (1, 0) maps to visible (0, -1), i.e. straight down, so
 * text drawn horizontally in user space reads vertically. Solving for the direction that maps to
 * visible (1, 0) gives +y, which is 90 degrees. Generalising over all four cases, the user-space
 * angle is simply the visible angle plus the rotation. Translation does not affect direction, so
 * the origin plays no part here.
 */
export function pageFrame(box: PageBox, rotationDegrees: number): PageFrame {
  const rotation = normalizeRotation(rotationDegrees);
  const quarterTurned = rotation === 90 || rotation === 270;
  // A rectangle written with its corners the wrong way round (allowed by the spec, emitted by
  // some generators) would otherwise give a negative extent and send every mark off the page.
  const bx = box.width < 0 ? box.x + box.width : box.x;
  const by = box.height < 0 ? box.y + box.height : box.y;
  const w = Math.abs(box.width);
  const h = Math.abs(box.height);

  return {
    width: quarterTurned ? h : w,
    height: quarterTurned ? w : h,
    rotation,
    toUserSpace(x, y) {
      switch (rotation) {
        case 90:
          return { x: bx + w - y, y: by + x };
        case 180:
          return { x: bx + w - x, y: by + h - y };
        case 270:
          return { x: bx + y, y: by + h - x };
        default:
          return { x: bx + x, y: by + y };
      }
    },
    toUserAngle(degrees) {
      return (((degrees + rotation) % 360) + 360) % 360;
    },
  };
}

/** Raised when text cannot be drawn with the built-in font. */
export class PdfTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfTextError';
  }
}

/**
 * Turn pdf-lib's encoding failure into something a user can act on.
 *
 * The built-in Helvetica is a standard PDF font, which means WinAnsi: roughly Latin-1 plus a
 * handful of typographic characters. Anything else — Vietnamese with tone marks, CJK, Greek,
 * Cyrillic, Arabic, emoji — makes `drawText` throw `WinAnsi cannot encode "..."`, and that
 * message reaches the user as an unexplained crash.
 *
 * Fixing it properly means embedding a Unicode font, which is one to two megabytes of vendored
 * bytes for every visitor. That is a deliberate follow-up rather than a silent limitation: say
 * plainly what the tool cannot do, and revisit if the analytics show people trying.
 *
 * Detected by catching rather than by pre-checking the string: pdf-lib's font object owns the
 * authoritative encoding table, and a hand-written copy of it here would drift.
 */
/**
 * Check the text can be drawn BEFORE reading the user's file.
 *
 * `rethrowAsTextError` below catches the failure at drawing time, which is correct but late: on
 * a 200 MB scan the person waits through the whole load and save to be told their watermark has
 * a character Helvetica cannot draw. This asks the question first, using pdf-lib's own encoding
 * table on a throwaway document — no hand-written copy of WinAnsi to drift out of date, and a
 * standard font costs nothing to embed since it is a reference by name, not glyph bytes.
 */
export async function assertDrawableText(text: string, subject: string): Promise<void> {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const probe = await PDFDocument.create();
  const font = await probe.embedFont(StandardFonts.Helvetica);
  try {
    font.encodeText(text);
  } catch (e) {
    rethrowAsTextError(e, subject);
  }
}

export function rethrowAsTextError(error: unknown, subject: string): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/cannot encode|winansi|encoding/i.test(message)) {
    throw new PdfTextError(
      `${subject} uses characters the built-in font cannot draw. This version has Helvetica only, which covers Latin characters — no Vietnamese tone marks, Chinese, Japanese, Korean, Greek, Cyrillic, Arabic or emoji.`,
    );
  }
  throw error instanceof Error ? error : new Error(message);
}
