// Geometry only — see shared/canvas-image.test.ts for why the encode path is hand-verified.
import { describe, expect, it } from 'vitest';
import { ASPECT_PRESETS, applyAspect, clampRect, cropImage } from './logic';

describe('cropImage', () => {
  it('rejects a file that is not an image with a code the widget can localize', async () => {
    // happy-dom has no createImageBitmap, which lands on the same "not an image" path a
    // corrupt file does in a browser — the one decode failure reachable here.
    const file = new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' });
    await expect(cropImage(file, { x: 0, y: 0, width: 1, height: 1 }, 'png')).rejects.toMatchObject(
      { code: 'imageUnreadable', params: { name: 'notes.txt' } },
    );
  });
});

describe('clampRect', () => {
  it('keeps a rectangle already inside the image', () => {
    const r = { x: 0.1, y: 0.2, width: 0.5, height: 0.5 };
    expect(clampRect(r)).toEqual(r);
  });

  it('pulls a rectangle back inside the right and bottom edges', () => {
    // toBeCloseTo, not toEqual: 1 - 0.8 is 0.19999999999999996 in binary floating point.
    // The rect is in fractions of the source and gets multiplied by pixel dimensions and
    // rounded, so that last bit never reaches the output.
    const r = clampRect({ x: 0.8, y: 0.8, width: 0.5, height: 0.5 });
    expect(r.x).toBe(0.8);
    expect(r.y).toBe(0.8);
    expect(r.width).toBeCloseTo(0.2, 10);
    expect(r.height).toBeCloseTo(0.2, 10);
  });

  it('clamps negative origins', () => {
    const r = clampRect({ x: -0.3, y: -0.1, width: 0.5, height: 0.5 });
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it('never produces an empty rectangle', () => {
    const r = clampRect({ x: 0.5, y: 0.5, width: 0, height: -1 });
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
  });
});

describe('applyAspect', () => {
  it('makes a square crop square in PIXELS on a non-square image', () => {
    // The trap: the rect is in fractions of the source, so equal fractions on a 2:1 image
    // are not a square. 1:1 must mean 1:1 on screen.
    const src = { w: 2000, h: 1000 };
    const r = applyAspect({ x: 0, y: 0, width: 1, height: 1 }, 1, src.w, src.h);
    expect(Math.round(r.width * src.w)).toBe(Math.round(r.height * src.h));
  });

  it('narrows a too-wide rectangle rather than growing it', () => {
    const r = applyAspect({ x: 0, y: 0, width: 1, height: 0.5 }, 1, 1000, 1000);
    expect(r.width).toBeLessThan(1);
    expect(r.height).toBeCloseTo(0.5, 5);
  });

  it('shortens a too-tall rectangle', () => {
    const r = applyAspect({ x: 0, y: 0, width: 0.5, height: 1 }, 1, 1000, 1000);
    expect(r.height).toBeLessThan(1);
    expect(r.width).toBeCloseTo(0.5, 5);
  });

  it('produces 16:9 at the right pixel ratio', () => {
    const r = applyAspect({ x: 0, y: 0, width: 1, height: 1 }, 16 / 9, 1920, 1920);
    expect((r.width * 1920) / (r.height * 1920)).toBeCloseTo(16 / 9, 3);
  });

  it('stays inside the image', () => {
    const r = applyAspect({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }, 1, 1000, 1000);
    expect(r.x + r.width).toBeLessThanOrEqual(1.0001);
    expect(r.y + r.height).toBeLessThanOrEqual(1.0001);
  });
});

describe('ASPECT_PRESETS', () => {
  it('offers a free-form option first', () => {
    expect(ASPECT_PRESETS[0]?.ratio).toBeNull();
  });
  it('has a positive ratio for every fixed preset', () => {
    for (const p of ASPECT_PRESETS.slice(1)) expect(p.ratio).toBeGreaterThan(0);
  });
});
