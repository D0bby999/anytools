import { describe, expect, it } from 'vitest';
import {
  type PolygonShape,
  clampPoint,
  insertPointAfter,
  movePoint,
  parseBoxSide,
  regularPolygon,
  removePoint,
  star,
  toCss,
  toCssBlock,
} from './logic';
import { CLIP_PRESETS } from './presets';

const triangle: PolygonShape = {
  kind: 'polygon',
  points: [
    { x: 50, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
};

describe('toCss', () => {
  it('writes a polygon as percentage pairs in order', () => {
    expect(toCss(triangle)).toBe('polygon(50% 0%, 100% 100%, 0% 100%)');
  });

  it('writes circle, ellipse and inset in their spec forms', () => {
    expect(toCss({ kind: 'circle', r: 50, cx: 50, cy: 50 })).toBe('circle(50% at 50% 50%)');
    expect(toCss({ kind: 'ellipse', rx: 40, ry: 25, cx: 50, cy: 50 })).toBe(
      'ellipse(40% 25% at 50% 50%)',
    );
    expect(toCss({ kind: 'inset', top: 10, right: 20, bottom: 10, left: 20, round: 0 })).toBe(
      'inset(10% 20% 10% 20%)',
    );
  });

  it('adds the round keyword only when there is a radius', () => {
    expect(toCss({ kind: 'inset', top: 5, right: 5, bottom: 5, left: 5, round: 12 })).toBe(
      'inset(5% 5% 5% 5% round 12%)',
    );
  });

  it('converts to px against the reference box, per axis', () => {
    expect(toCss(triangle, 'px', { width: 400, height: 200 })).toBe(
      'polygon(200px 0px, 400px 200px, 0px 200px)',
    );
  });

  it('resolves a circle radius against the diagonal, not the width', () => {
    // sqrt(400² + 200²) / sqrt(2) = 316.2…; half of that is 158px.
    expect(
      toCss({ kind: 'circle', r: 50, cx: 50, cy: 50 }, 'px', { width: 400, height: 200 }),
    ).toBe('circle(158px at 200px 100px)');
  });

  it('wraps the value in a declaration', () => {
    expect(toCssBlock(triangle)).toBe('clip-path: polygon(50% 0%, 100% 100%, 0% 100%);');
  });
});

describe('clampPoint / movePoint', () => {
  it('keeps a dragged vertex inside the box', () => {
    expect(clampPoint({ x: -14, y: 180 })).toEqual({ x: 0, y: 100 });
  });

  it('rounds to one decimal so the CSS stays readable', () => {
    expect(clampPoint({ x: 33.333333, y: 66.666666 })).toEqual({ x: 33.3, y: 66.7 });
  });

  it('moves only the vertex it was given', () => {
    const moved = movePoint(triangle, 1, { x: 90, y: 10 });
    expect(moved.points).toEqual([
      { x: 50, y: 0 },
      { x: 90, y: 10 },
      { x: 0, y: 100 },
    ]);
    expect(toCss(moved)).toBe('polygon(50% 0%, 90% 10%, 0% 100%)');
  });

  it('leaves the shape alone for an index that does not exist', () => {
    expect(movePoint(triangle, 9, { x: 1, y: 1 }).points).toEqual(triangle.points);
  });

  // The canvas captures the pointer on pointerdown, so a drag that runs past the edge
  // keeps sending moves with out-of-range coordinates; the clamp is what turns those
  // into a vertex parked exactly on 0% or 100%.
  it('parks a vertex dragged past the edge exactly on the boundary', () => {
    expect(movePoint(triangle, 0, { x: -30, y: -12 }).points[0]).toEqual({ x: 0, y: 0 });
    expect(movePoint(triangle, 0, { x: 140, y: 260 }).points[0]).toEqual({ x: 100, y: 100 });
  });
});

describe('parseBoxSide', () => {
  it('reads a usable px size', () => {
    expect(parseBoxSide('400')).toBe(400);
    expect(parseBoxSide(' 12.5 ')).toBe(12.5);
  });

  it('refuses an emptied or unusable field, so the CSS keeps the last good box', () => {
    // Without this, clearing the width field to retype it produced
    // `circle(0px at 0px 0px)` — a shape that clips the whole element away.
    expect(parseBoxSide('')).toBeNull();
    expect(parseBoxSide('   ')).toBeNull();
    expect(parseBoxSide('-')).toBeNull();
    expect(parseBoxSide('0')).toBeNull();
    expect(parseBoxSide('-200')).toBeNull();
    expect(parseBoxSide('abc')).toBeNull();
  });
});

describe('insertPointAfter', () => {
  it('adds the midpoint of the chosen edge, in place', () => {
    const next = insertPointAfter(triangle, 0);
    expect(next.points).toEqual([
      { x: 50, y: 0 },
      { x: 75, y: 50 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ]);
  });

  it('wraps the closing edge back to the first vertex', () => {
    const next = insertPointAfter(triangle, 2);
    expect(next.points[3]).toEqual({ x: 25, y: 50 });
    expect(next.points).toHaveLength(4);
  });
});

describe('removePoint', () => {
  it('removes the vertex at the index', () => {
    const four = insertPointAfter(triangle, 0);
    expect(removePoint(four, 1).points).toEqual(triangle.points);
  });

  it('refuses to go below three vertices', () => {
    expect(removePoint(triangle, 0)).toBe(triangle);
  });
});

describe('regularPolygon / star', () => {
  it('puts the first vertex of an n-gon at the top centre', () => {
    expect(regularPolygon(6).points[0]).toEqual({ x: 50, y: 0 });
  });

  it('produces one vertex per side', () => {
    expect(regularPolygon(5).points).toHaveLength(5);
    expect(regularPolygon(8).points).toHaveLength(8);
  });

  it('alternates outer and inner radii for a star', () => {
    const s = star(5);
    expect(s.points).toHaveLength(10);
    const distance = (i: number) => {
      const p = s.points[i] as { x: number; y: number };
      return Math.hypot(p.x - 50, p.y - 50);
    };
    expect(distance(0)).toBeCloseTo(50, 0);
    expect(distance(1)).toBeCloseTo(25, 0);
  });
});

describe('presets', () => {
  it('ships twelve shapes', () => {
    expect(CLIP_PRESETS).toHaveLength(12);
  });

  it('keeps every preset vertex inside the reference box', () => {
    for (const preset of CLIP_PRESETS) {
      for (const p of (preset.shape as PolygonShape).points) {
        expect(p.x, preset.name).toBeGreaterThanOrEqual(0);
        expect(p.x, preset.name).toBeLessThanOrEqual(100);
        expect(p.y, preset.name).toBeGreaterThanOrEqual(0);
        expect(p.y, preset.name).toBeLessThanOrEqual(100);
      }
    }
  });

  it('has at least three vertices in every preset', () => {
    for (const preset of CLIP_PRESETS) {
      expect((preset.shape as PolygonShape).points.length, preset.name).toBeGreaterThanOrEqual(3);
    }
  });
});
