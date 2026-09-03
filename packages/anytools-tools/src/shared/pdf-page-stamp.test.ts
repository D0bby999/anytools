// @vitest-environment node
// Pure geometry — no PDF, no DOM. This is the mapping that decides whether every position
// control on add-page-numbers and watermark-pdf points where the user thinks it does.
import { describe, expect, it } from 'vitest';
import { PdfTextError, normalizeRotation, pageFrame, rethrowAsTextError } from './pdf-page-stamp';

const A4 = [595, 842] as const;

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
    expect(pageFrame(...A4, 0)).toMatchObject({ width: 595, height: 842 });
    expect(pageFrame(...A4, 180)).toMatchObject({ width: 595, height: 842 });
    expect(pageFrame(...A4, 90)).toMatchObject({ width: 842, height: 595 });
    expect(pageFrame(...A4, 270)).toMatchObject({ width: 842, height: 595 });
  });

  it('is the identity on an unrotated page', () => {
    const frame = pageFrame(...A4, 0);
    expect(frame.toUserSpace(10, 20)).toEqual({ x: 10, y: 20 });
    expect(frame.toUserAngle(45)).toBe(45);
  });

  for (const rotation of [0, 90, 180, 270]) {
    it(`maps the visible corners onto the media box corners at /Rotate ${rotation}`, () => {
      const frame = pageFrame(...A4, rotation);
      const corners = [
        frame.toUserSpace(0, 0),
        frame.toUserSpace(frame.width, 0),
        frame.toUserSpace(0, frame.height),
        frame.toUserSpace(frame.width, frame.height),
      ];
      // Whatever the rotation, the four visible corners must be the four media-box corners —
      // each exactly once. A sign error or a swapped axis breaks this and nothing else does.
      const sorted = corners.map((c) => `${c.x},${c.y}`).sort();
      expect(sorted).toEqual(['0,0', '0,842', '595,0', '595,842'].sort());
    });

    it(`keeps points inside the page at /Rotate ${rotation}`, () => {
      const frame = pageFrame(...A4, rotation);
      const { x, y } = frame.toUserSpace(frame.width / 3, frame.height / 4);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(595);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(842);
    });
  }

  it('bottom-left as the reader sees it becomes the right corner on a page turned clockwise', () => {
    // /Rotate 90 turns the sheet clockwise, so the sheet's bottom-right corner ends up at the
    // reader's bottom-left. Worked through by hand in the module docblock; asserted here so a
    // "simplification" of the formula cannot quietly invert it.
    expect(pageFrame(...A4, 90).toUserSpace(0, 0)).toEqual({ x: 595, y: 0 });
    expect(pageFrame(...A4, 270).toUserSpace(0, 0)).toEqual({ x: 0, y: 842 });
    expect(pageFrame(...A4, 180).toUserSpace(0, 0)).toEqual({ x: 595, y: 842 });
  });

  it('adds the page rotation to the text angle, wrapping at a full turn', () => {
    expect(pageFrame(...A4, 90).toUserAngle(0)).toBe(90);
    expect(pageFrame(...A4, 270).toUserAngle(45)).toBe(315);
    expect(pageFrame(...A4, 180).toUserAngle(270)).toBe(90);
    expect(pageFrame(...A4, 90).toUserAngle(-45)).toBe(45);
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

  it('passes anything else through untouched — it is not a catch-all', () => {
    const other = new Error('out of memory');
    expect(() => rethrowAsTextError(other, 'The label')).toThrow(other);
    expect(() => rethrowAsTextError(other, 'The label')).not.toThrow(PdfTextError);
  });

  it('still throws an Error when handed a non-Error', () => {
    expect(() => rethrowAsTextError('boom', 'The label')).toThrow(/boom/);
  });
});
