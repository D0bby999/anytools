import { describe, expect, it } from 'vitest';
import { type GradientState, parse, toCss, toCssBlock, toTailwind, withKind } from './logic';
import { GRADIENT_PRESETS } from './presets';

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

describe('parse round trip', () => {
  const cases: [string, GradientState][] = [
    ['plain linear', linear],
    ['negative angle', { ...linear, angle: -45 }],
    ['fractional angle', { ...linear, angle: 22.5 }],
    [
      'stops without a position',
      { ...linear, stops: [...linear.stops].map((s) => ({ ...s, position: null })) },
    ],
    [
      'hsl and rgba colours',
      {
        ...linear,
        stops: [
          { color: 'hsl(210, 90%, 60%)', position: 0 },
          { color: 'rgba(0, 0, 0, 0.5)', position: 100 },
        ],
      },
    ],
    ['repeating linear', { ...linear, repeating: true }],
    [
      'radial with centre',
      {
        kind: 'radial',
        shape: 'ellipse',
        size: 'farthest-side',
        cx: 25,
        cy: 75,
        repeating: false,
        stops: [
          { color: 'gold', position: 10 },
          { color: 'navy', position: 90 },
        ],
      },
    ],
    [
      'repeating conic',
      {
        kind: 'conic',
        angle: 120,
        cx: 40,
        cy: 60,
        repeating: true,
        stops: [
          { color: '#FF0000', position: 0 },
          { color: '#00FF00', position: 50 },
          { color: '#FF0000', position: 100 },
        ],
      },
    ],
    ['three stops', { ...linear, stops: [...linear.stops, { color: '#123456', position: 50 }] }],
  ];

  for (const [name, state] of cases) {
    it(`round-trips ${name}`, () => {
      expect(parse(toCss(state))).toEqual(state);
    });
  }

  it('round-trips every preset', () => {
    for (const preset of GRADIENT_PRESETS) {
      expect(parse(toCss(preset.state)), preset.name).toEqual(preset.state);
    }
  });
});

describe('parse', () => {
  it('accepts a full declaration with the property name and semicolon', () => {
    expect(parse('  background: linear-gradient(90deg, red, blue);  ')).toEqual({
      kind: 'linear',
      angle: 90,
      repeating: false,
      stops: [
        { color: 'red', position: null },
        { color: 'blue', position: null },
      ],
    });
  });

  it('converts turn, rad and grad to degrees', () => {
    expect((parse('linear-gradient(0.25turn, red, blue)') as { angle: number }).angle).toBe(90);
    expect((parse('linear-gradient(200grad, red, blue)') as { angle: number }).angle).toBe(180);
    expect(
      (parse('linear-gradient(3.141592653589793rad, red, blue)') as { angle: number }).angle,
    ).toBeCloseTo(180, 6);
  });

  it('maps the side and corner keywords to degrees', () => {
    expect((parse('linear-gradient(to right, red, blue)') as { angle: number }).angle).toBe(90);
    expect((parse('linear-gradient(to top, red, blue)') as { angle: number }).angle).toBe(0);
    expect((parse('linear-gradient(to bottom left, red, blue)') as { angle: number }).angle).toBe(
      225,
    );
  });

  it('defaults a directionless linear gradient to 180deg, the CSS default', () => {
    expect((parse('linear-gradient(red, blue)') as { angle: number }).angle).toBe(180);
  });

  it('does not mistake the first colour stop for geometry', () => {
    expect(parse('radial-gradient(red, blue)')).toEqual({
      kind: 'radial',
      shape: 'ellipse',
      size: 'farthest-corner',
      cx: 50,
      cy: 50,
      repeating: false,
      stops: [
        { color: 'red', position: null },
        { color: 'blue', position: null },
      ],
    });
    expect((parse('conic-gradient(red, blue)') as { stops: unknown[] }).stops).toHaveLength(2);
  });

  it('expands a double-position stop into two stops', () => {
    expect(
      (parse('linear-gradient(90deg, red 0% 40%, blue 40% 100%)') as GradientState).stops,
    ).toEqual([
      { color: 'red', position: 0 },
      { color: 'red', position: 40 },
      { color: 'blue', position: 40 },
      { color: 'blue', position: 100 },
    ]);
  });

  it('keeps commas inside a colour function together', () => {
    const g = parse('linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)');
    expect((g as GradientState).stops.map((s) => s.color)).toEqual([
      'rgb(255, 0, 0)',
      'rgb(0, 0, 255)',
    ]);
  });

  it('rejects what it cannot represent instead of guessing', () => {
    expect(parse('linear-gradient(90deg, red 0px, blue 100px)')).toBeNull(); // px stops
    expect(parse('radial-gradient(200px 100px at 50% 50%, red, blue)')).toBeNull(); // explicit radii
    expect(parse('linear-gradient(90deg, red, 40%, blue)')).toBeNull(); // interpolation hint
    expect(parse('linear-gradient(90deg, red)')).toBeNull(); // one stop is not a gradient
    expect(parse('linear-gradient(to nowhere, red, blue)')).toBeNull();
    expect(parse('url(cat.png)')).toBeNull();
    expect(parse('')).toBeNull();
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
