import { describe, expect, it } from 'vitest';
import {
  type GradientState,
  pointerPercent,
  toCss,
  toCssBlock,
  toTailwind,
  trackPositions,
  withKind,
} from './logic';

const linear: GradientState = {
  kind: 'linear',
  angle: 90,
  repeating: false,
  stops: [
    { color: '#FFFFFF', position: 0 },
    { color: '#000000', position: 100 },
  ],
};

describe('toCss', () => {
  it('emits an explicit angle for linear gradients', () => {
    expect(toCss(linear)).toBe('linear-gradient(90deg, #FFFFFF 0%, #000000 100%)');
  });

  it('emits shape, size and centre for radial gradients', () => {
    expect(
      toCss({
        kind: 'radial',
        shape: 'circle',
        size: 'closest-side',
        cx: 30,
        cy: 70,
        repeating: false,
        stops: [
          { color: 'red', position: null },
          { color: 'blue', position: null },
        ],
      }),
    ).toBe('radial-gradient(circle closest-side at 30% 70%, red, blue)');
  });

  it('emits `from` and centre for conic gradients', () => {
    expect(
      toCss({
        kind: 'conic',
        angle: 45,
        cx: 50,
        cy: 50,
        repeating: true,
        stops: [
          { color: '#111', position: 0 },
          { color: '#222', position: 25 },
        ],
      }),
    ).toBe('repeating-conic-gradient(from 45deg at 50% 50%, #111 0%, #222 25%)');
  });

  it('omits the position of stops the browser should distribute', () => {
    expect(toCss({ ...linear, stops: [{ color: 'red', position: null }, ...linear.stops] })).toBe(
      'linear-gradient(90deg, red, #FFFFFF 0%, #000000 100%)',
    );
  });
});

describe('toCssBlock / toTailwind', () => {
  it('puts the first stop colour on a fallback line before the gradient', () => {
    expect(toCssBlock(linear)).toBe(
      'background: #FFFFFF;\nbackground: linear-gradient(90deg, #FFFFFF 0%, #000000 100%);',
    );
  });

  it('replaces every space with an underscore for the Tailwind arbitrary value', () => {
    expect(toTailwind(linear)).toBe('bg-[linear-gradient(90deg,_#FFFFFF_0%,_#000000_100%)]');
  });
});

describe('withKind', () => {
  it('keeps the stops when switching kind', () => {
    expect(withKind(linear, 'conic')).toEqual({
      kind: 'conic',
      angle: 90,
      cx: 50,
      cy: 50,
      repeating: false,
      stops: linear.stops,
    });
  });

  it('carries the centre from radial to conic and back', () => {
    const radial = withKind({ ...linear, angle: 10 }, 'radial');
    const moved = { ...radial, cx: 10, cy: 90 } as GradientState;
    expect(withKind(moved, 'conic')).toMatchObject({ kind: 'conic', cx: 10, cy: 90 });
  });

  it('gives a linear gradient an angle even when coming from radial', () => {
    const radial = withKind(linear, 'radial');
    expect(withKind(radial, 'linear')).toMatchObject({ kind: 'linear', angle: 90 });
  });
});

describe('trackPositions', () => {
  it('returns explicit positions unchanged', () => {
    expect(trackPositions(linear.stops)).toEqual([0, 100]);
  });

  it('anchors an unpositioned first and last stop at 0% and 100%', () => {
    expect(
      trackPositions([
        { color: 'red', position: null },
        { color: 'blue', position: null },
      ]),
    ).toEqual([0, 100]);
  });

  it('spaces a run of unpositioned stops evenly between its neighbours', () => {
    const [a, b, c, d] = trackPositions([
      { color: 'a', position: 0 },
      { color: 'b', position: null },
      { color: 'c', position: null },
      { color: 'd', position: 100 },
    ]);
    expect(a).toBe(0);
    expect(b).toBeCloseTo(33.33, 1);
    expect(c).toBeCloseTo(66.67, 1);
    expect(d).toBe(100);
  });

  it('interpolates between the surrounding explicit positions, not the whole track', () => {
    expect(
      trackPositions([
        { color: 'a', position: 10 },
        { color: 'b', position: null },
        { color: 'c', position: 50 },
      ]),
    ).toEqual([10, 30, 50]);
  });

  it('leaves backwards positions where they were typed', () => {
    expect(
      trackPositions([
        { color: 'a', position: 60 },
        { color: 'b', position: 20 },
      ]),
    ).toEqual([60, 20]);
  });

  it('handles an empty stop list', () => {
    expect(trackPositions([])).toEqual([]);
  });
});

describe('pointerPercent', () => {
  const rect = { left: 100, width: 400 };

  it('maps a pointer inside the track to a percentage', () => {
    expect(pointerPercent(300, rect)).toBe(50);
  });

  it('clamps a drag that runs past either end, so 0% and 100% are reachable', () => {
    expect(pointerPercent(-40, rect)).toBe(0);
    expect(pointerPercent(9999, rect)).toBe(100);
  });

  it('rounds to one decimal', () => {
    expect(pointerPercent(201, rect)).toBe(25.3);
  });

  it('does not divide by a zero width', () => {
    expect(pointerPercent(10, { left: 0, width: 0 })).toBe(0);
  });
});
