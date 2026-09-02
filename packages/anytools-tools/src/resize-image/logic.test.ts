// Geometry only. The encode path needs a real canvas, which happy-dom does not provide and
// this repo has no browser lane for — see shared/canvas-image.test.ts.
import { describe, expect, it } from 'vitest';
import { targetSize } from './logic';

describe('targetSize', () => {
  it('fits inside a box without distorting', () => {
    expect(targetSize({ kind: 'fit', maxWidth: 1920, maxHeight: 1920 }, 4000, 3000)).toEqual({
      width: 1920,
      height: 1440,
    });
  });

  it('does not enlarge in fit mode', () => {
    expect(targetSize({ kind: 'fit', maxWidth: 1920, maxHeight: 1920 }, 800, 600)).toEqual({
      width: 800,
      height: 600,
    });
  });

  it('scales by percent', () => {
    expect(targetSize({ kind: 'percent', percent: 50 }, 1000, 800)).toEqual({
      width: 500,
      height: 400,
    });
  });

  it('allows percent above 100 — asking to upscale is explicit here', () => {
    expect(targetSize({ kind: 'percent', percent: 200 }, 100, 50)).toEqual({
      width: 200,
      height: 100,
    });
  });

  it('never yields a zero dimension', () => {
    // 1% of a 20px image rounds to 0, which makes an unusable canvas.
    expect(targetSize({ kind: 'percent', percent: 1 }, 20, 20)).toEqual({ width: 1, height: 1 });
    expect(targetSize({ kind: 'exact', width: 0, height: 0 }, 100, 100)).toEqual({
      width: 1,
      height: 1,
    });
  });

  it('takes exact dimensions verbatim, ratio be damned', () => {
    expect(targetSize({ kind: 'exact', width: 300, height: 300 }, 1000, 500)).toEqual({
      width: 300,
      height: 300,
    });
  });
});
