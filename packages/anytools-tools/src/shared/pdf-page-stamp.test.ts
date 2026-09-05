// @vitest-environment node
// Pure geometry — no PDF, no DOM. This is the mapping that decides whether every position
// control on add-page-numbers and watermark-pdf points where the user thinks it does.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  PdfTextError,
  assertDrawableText,
  normalizeRotation,
  pageFrame,
  rethrowAsTextError,
} from './pdf-page-stamp';
import { hasNotoFont, stubNotoFetch } from './test-unicode-font';

/** A4 at the origin — the easy case, and the only one `getWidth()`/`getHeight()` describe. */
const A4 = { x: 0, y: 0, width: 595, height: 842 };
/** The same sheet, imposed: same extent, lower-left corner at (100, 200). */
const A4_SHIFTED = { x: 100, y: 200, width: 595, height: 842 };
/** A crop box inside a 595x842 media box, off-centre so its middle is its own, not the sheet's. */
const CROPPED = { x: 80, y: 40, width: 445, height: 702 };

describe('normalizeRotation', () => {
  it('keeps the four quarter turns', () => {
    expect([0, 90, 180, 270].map(normalizeRotation)).toEqual([0, 90, 180, 270]);
  });

  it('wraps values outside one turn, in both directions', () => {
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-360)).toBe(0);
    expect(normalizeRotation(720)).toBe(0);
  });

  it('rounds a rotation that is not a quarter turn', () => {
    // /Rotate is required to be a multiple of 90, but broken generators emit others and
    // pdf-lib passes them straight through. Rounding beats producing NaN coordinates.
    expect(normalizeRotation(89)).toBe(90);
    expect(normalizeRotation(44)).toBe(0);
    expect(normalizeRotation(46)).toBe(90);
  });
});

describe('pageFrame', () => {
  it('reports the size the reader sees, swapping on a quarter turn', () => {
    expect(pageFrame(A4, 0)).toMatchObject({ width: 595, height: 842 });
    expect(pageFrame(A4, 180)).toMatchObject({ width: 595, height: 842 });
    expect(pageFrame(A4, 90)).toMatchObject({ width: 842, height: 595 });
    expect(pageFrame(A4, 270)).toMatchObject({ width: 842, height: 595 });
  });

  it('takes its size from the box, so a crop box reports the cropped size', () => {
    expect(pageFrame(CROPPED, 0)).toMatchObject({ width: 445, height: 702 });
    expect(pageFrame(CROPPED, 90)).toMatchObject({ width: 702, height: 445 });
    // The origin never shows up in the size — only in where points land.
    expect(pageFrame(A4_SHIFTED, 0)).toMatchObject({ width: 595, height: 842 });
  });

  it('is the identity on an unrotated page at the origin', () => {
    const frame = pageFrame(A4, 0);
    expect(frame.toUserSpace(10, 20)).toEqual({ x: 10, y: 20 });
    expect(frame.toUserAngle(45)).toBe(45);
  });

  for (const rotation of [0, 90, 180, 270]) {
    it(`maps the visible corners onto the box corners at /Rotate ${rotation}`, () => {
      const frame = pageFrame(A4, rotation);
      const corners = [
        frame.toUserSpace(0, 0),
        frame.toUserSpace(frame.width, 0),
        frame.toUserSpace(0, frame.height),
        frame.toUserSpace(frame.width, frame.height),
      ];
      // Whatever the rotation, the four visible corners must be the four box corners — each
      // exactly once. A sign error or a swapped axis breaks this and nothing else does.
      const sorted = corners.map((c) => `${c.x},${c.y}`).sort();
      expect(sorted).toEqual(['0,0', '0,842', '595,0', '595,842'].sort());
    });

    it(`maps the visible corners onto a SHIFTED box's corners at /Rotate ${rotation}`, () => {
      // The same four-corners property with the box at (100, 200): corners are (100, 200),
      // (695, 200), (100, 1042), (695, 1042). Dropping the origin — what getSize() does —
      // produces the unshifted set instead, none of which is on this page.
      const frame = pageFrame(A4_SHIFTED, rotation);
      const corners = [
        frame.toUserSpace(0, 0),
        frame.toUserSpace(frame.width, 0),
        frame.toUserSpace(0, frame.height),
        frame.toUserSpace(frame.width, frame.height),
      ];
      const sorted = corners.map((c) => `${c.x},${c.y}`).sort();
      expect(sorted).toEqual(['100,200', '695,200', '100,1042', '695,1042'].sort());
    });

    it(`keeps points inside the page at /Rotate ${rotation}`, () => {
      const frame = pageFrame(A4, rotation);
      const { x, y } = frame.toUserSpace(frame.width / 3, frame.height / 4);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(595);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(842);
    });

    it(`keeps points inside a crop box at /Rotate ${rotation}`, () => {
      // CropBox [80 40 525 742]. A point one margin in from the visible bottom-left must land
      // inside those bounds — the media box would have accepted (36, 36), which the reader
      // never displays.
      const frame = pageFrame(CROPPED, rotation);
      const { x, y } = frame.toUserSpace(36, 36);
      expect(x).toBeGreaterThanOrEqual(80);
      expect(x).toBeLessThanOrEqual(525);
      expect(y).toBeGreaterThanOrEqual(40);
      expect(y).toBeLessThanOrEqual(742);
    });

    it(`puts the visible centre on the box's own centre at /Rotate ${rotation}`, () => {
      // Whatever the rotation, the middle of the page is the middle of the box: (302.5, 391)
      // for CropBox [80 40 525 742]. This is the assertion the watermark depends on.
      const frame = pageFrame(CROPPED, rotation);
      expect(frame.toUserSpace(frame.width / 2, frame.height / 2)).toEqual({ x: 302.5, y: 391 });
    });
  }

  it('bottom-left as the reader sees it becomes the right corner on a page turned clockwise', () => {
    // /Rotate 90 turns the sheet clockwise, so the sheet's bottom-right corner ends up at the
    // reader's bottom-left. Worked through by hand in the module docblock; asserted here so a
    // "simplification" of the formula cannot quietly invert it.
    expect(pageFrame(A4, 90).toUserSpace(0, 0)).toEqual({ x: 595, y: 0 });
    expect(pageFrame(A4, 270).toUserSpace(0, 0)).toEqual({ x: 0, y: 842 });
    expect(pageFrame(A4, 180).toUserSpace(0, 0)).toEqual({ x: 595, y: 842 });
  });

  it('places a bottom-left margin point on each of the four rotations of a shifted box', () => {
    // MediaBox [100 200 695 1042], the visible point (36, 36). Derived by hand from the four
    // cases in the module docblock, with w = 595 and h = 842:
    //   0   → (100 + 36, 200 + 36)              = (136, 236)
    //   90  → (100 + 595 - 36, 200 + 36)        = (659, 236)
    //   180 → (100 + 595 - 36, 200 + 842 - 36)  = (659, 1006)
    //   270 → (100 + 36, 200 + 842 - 36)        = (136, 1006)
    expect(pageFrame(A4_SHIFTED, 0).toUserSpace(36, 36)).toEqual({ x: 136, y: 236 });
    expect(pageFrame(A4_SHIFTED, 90).toUserSpace(36, 36)).toEqual({ x: 659, y: 236 });
    expect(pageFrame(A4_SHIFTED, 180).toUserSpace(36, 36)).toEqual({ x: 659, y: 1006 });
    expect(pageFrame(A4_SHIFTED, 270).toUserSpace(36, 36)).toEqual({ x: 136, y: 1006 });
  });

  it('places the same point on the four rotations of a crop box', () => {
    // CropBox [80 40 525 742]: origin (80, 40), w = 445, h = 702, visible point (36, 36).
    //   0   → (80 + 36, 40 + 36)               = (116, 76)
    //   90  → (80 + 445 - 36, 40 + 36)         = (489, 76)
    //   180 → (80 + 445 - 36, 40 + 702 - 36)   = (489, 706)
    //   270 → (80 + 36, 40 + 702 - 36)         = (116, 706)
    expect(pageFrame(CROPPED, 0).toUserSpace(36, 36)).toEqual({ x: 116, y: 76 });
    expect(pageFrame(CROPPED, 90).toUserSpace(36, 36)).toEqual({ x: 489, y: 76 });
    expect(pageFrame(CROPPED, 180).toUserSpace(36, 36)).toEqual({ x: 489, y: 706 });
    expect(pageFrame(CROPPED, 270).toUserSpace(36, 36)).toEqual({ x: 116, y: 706 });
  });

  it('normalises a box whose corners are the wrong way round', () => {
    // [695 1042 100 200] read as a rectangle gives a negative extent. Some generators emit
    // these; taking them literally puts every mark off the sheet.
    const reversed = { x: 695, y: 1042, width: -595, height: -842 };
    expect(pageFrame(reversed, 0)).toMatchObject({ width: 595, height: 842 });
    expect(pageFrame(reversed, 0).toUserSpace(36, 36)).toEqual({ x: 136, y: 236 });
  });

  it('adds the page rotation to the text angle, wrapping at a full turn', () => {
    expect(pageFrame(A4, 90).toUserAngle(0)).toBe(90);
    expect(pageFrame(A4, 270).toUserAngle(45)).toBe(315);
    expect(pageFrame(A4, 180).toUserAngle(270)).toBe(90);
    expect(pageFrame(A4, 90).toUserAngle(-45)).toBe(45);
  });

  it('leaves the angle alone when the box moves — translation has no direction', () => {
    expect(pageFrame(A4_SHIFTED, 90).toUserAngle(45)).toBe(pageFrame(A4, 90).toUserAngle(45));
  });
});

describe('rethrowAsTextError', () => {
  it('turns an encoding failure into an explanation naming the limitation', () => {
    const raw = new Error('WinAnsi cannot encode "ế" (0x1ebf)');
    expect(() => rethrowAsTextError(raw, 'The watermark')).toThrow(PdfTextError);
    try {
      rethrowAsTextError(raw, 'The watermark');
    } catch (e) {
      expect((e as Error).message).toMatch(/^The watermark/);
      expect((e as Error).message).toMatch(/Latin characters/);
      expect((e as Error).message).toMatch(/Vietnamese/);
    }
  });

  it('carries the subject and any extra params for a localized template', () => {
    const raw = new Error('WinAnsi cannot encode "ế" (0x1ebf)');
    try {
      rethrowAsTextError(raw, 'The page number "3"', { label: '3' });
    } catch (e) {
      expect(e).toMatchObject({
        code: 'textNotDrawable',
        params: { subject: 'The page number "3"', label: '3' },
      });
    }
  });

  it('passes anything else through untouched — it is not a catch-all', () => {
    const other = new Error('out of memory');
    expect(() => rethrowAsTextError(other, 'The label')).toThrow(other);
    expect(() => rethrowAsTextError(other, 'The label')).not.toThrow(PdfTextError);
  });

  it('still throws an Error when handed a non-Error', () => {
    expect(() => rethrowAsTextError('boom', 'The label')).toThrow(/boom/);
  });
});

describe('assertDrawableText', () => {
  beforeAll(() => {
    if (hasNotoFont()) stubNotoFetch();
  });
  afterAll(() => vi.unstubAllGlobals());

  it('rejects text no available font can draw, naming the characters', async () => {
    for (const text of ['机密文件', '🙂']) {
      await expect(assertDrawableText(text, 'The watermark text')).rejects.toThrow(PdfTextError);
    }
    await expect(assertDrawableText('机密文件', 'The watermark text')).rejects.toThrow(
      /^The watermark text/,
    );
  });

  // Review 2026-09-05: "Tài liệu mật" was refused on a site with a Vietnamese edition.
  it.skipIf(!hasNotoFont())('accepts Vietnamese, Greek and Cyrillic via Noto Sans', async () => {
    for (const text of ['Tài liệu mật', 'BẢN NHÁP', 'КОНФИДЕНЦИАЛЬНО', 'Απόρρητο']) {
      await expect(assertDrawableText(text, 'The watermark text')).resolves.toBeUndefined();
    }
  });

  it.skipIf(!hasNotoFont())('names only the characters Noto Sans lacks', async () => {
    await expect(assertDrawableText('Mật 机密', 'The watermark text')).rejects.toThrow(
      /can draw: 机 密\./,
    );
  });

  it('accepts the accented Latin WinAnsi does cover', async () => {
    // The point of asking pdf-lib rather than hand-rolling a character test: "Latin only" is
    // not "ASCII only", and a home-made check would almost certainly reject these.
    for (const text of ['CONFIDENTIAL', 'BRÖTCHEN ÉTÉ', 'Draft — 12 / 40', 'çà et là ¼ ©']) {
      await expect(assertDrawableText(text, 'The watermark text')).resolves.toBeUndefined();
    }
  });
});
