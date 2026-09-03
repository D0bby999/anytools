/**
 * Helpers for drawing something ONTO an existing PDF page. Shared by add-page-numbers and
 * watermark-pdf, which are the same operation with different marks.
 *
 * The hard part is `/Rotate`. A PDF page has a media box in user space and, separately, a
 * rotation the reader applies before showing it. pdf-lib draws in user space and knows nothing
 * about that rotation, so on a page scanned sideways — `/Rotate 90`, extremely common, and what
 * fixtures/text-3p.pdf page 2 carries — a page number placed at "bottom right of the media box"
 * appears rotated 90 degrees in a different corner entirely. Every position control on both
 * tools is meaningless without this mapping, so it lives here with its derivation and its own
 * tests rather than being re-derived twice.
 */

export type Rotation = 0 | 90 | 180 | 270;

export type PageFrame = {
  /** Page width as the READER sees it — the media box swapped when rotated a quarter turn. */
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
 * Build the mapping for one page.
 *
 * Derivation, for `/Rotate 90` (the reader turns the sheet a quarter turn CLOCKWISE). A
 * clockwise quarter turn sends (x, y) to (y, -x); the media box is w by h, so the second
 * coordinate lands in [-w, 0] and w is added to bring it back. Hence a user-space point
 * appears at visible (y, w - x), and inverting gives x = w - vy, y = vx — which is what
 * `toUserSpace` returns. Checking one corner by hand: user (0, 0) is the bottom-left of the
 * sheet, and after turning the sheet clockwise the bottom-left corner is at the TOP-left, which
 * is visible (0, w). The formula agrees.
 *
 * For the angle: user direction (1, 0) maps to visible (0, -1), i.e. straight down, so text
 * drawn horizontally in user space reads vertically. Solving for the direction that maps to
 * visible (1, 0) gives user +y, which is 90 degrees. Generalising over all four cases, the
 * user-space angle is simply the visible angle plus the rotation.
 */
export function pageFrame(
  mediaWidth: number,
  mediaHeight: number,
  rotationDegrees: number,
): PageFrame {
  const rotation = normalizeRotation(rotationDegrees);
  const quarterTurned = rotation === 90 || rotation === 270;

  return {
    width: quarterTurned ? mediaHeight : mediaWidth,
    height: quarterTurned ? mediaWidth : mediaHeight,
    rotation,
    toUserSpace(x, y) {
      switch (rotation) {
        case 90:
          return { x: mediaWidth - y, y: x };
        case 180:
          return { x: mediaWidth - x, y: mediaHeight - y };
        case 270:
          return { x: y, y: mediaHeight - x };
        default:
          return { x, y };
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
export function rethrowAsTextError(error: unknown, subject: string): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/cannot encode|winansi|encoding/i.test(message)) {
    throw new PdfTextError(
      `${subject} uses characters the built-in font cannot draw. This version has Helvetica only, which covers Latin characters — no Vietnamese tone marks, Chinese, Japanese, Korean, Greek, Cyrillic, Arabic or emoji.`,
    );
  }
  throw error instanceof Error ? error : new Error(message);
}
