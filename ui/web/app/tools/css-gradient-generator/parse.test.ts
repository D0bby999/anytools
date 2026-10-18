import { describe, expect, it } from 'vitest';
import { type GradientState, toCss } from './logic';
import { parse, parseGradient } from './parse';
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

/** The reason string, or '' when the input parsed — keeps the rejection tests short. */
function reason(input: string): string {
  const result = parseGradient(input);
  return result.ok ? '' : result.reason;
}

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

  it('takes modern colour functions as stop colours', () => {
    // `color-mix(in srgb, …)` carries an `in` of its own; it is a colour, not the
    // gradient's interpolation method, and only the latter is refused.
    expect(
      parse('linear-gradient(90deg, oklch(70% 0.1 200) 0%, color-mix(in srgb, red, blue) 100%)'),
    ).not.toBeNull();
  });
});

describe('parse refuses what it cannot represent', () => {
  it('rejects lengths, radii and interpolation hints', () => {
    expect(reason('linear-gradient(90deg, red 0px, blue 100px)')).toMatch(/percentages/i);
    expect(reason('radial-gradient(200px 100px at 50% 50%, red, blue)')).toMatch(/radii/i);
    expect(reason('linear-gradient(90deg, red, 40%, blue)')).toMatch(/interpolation hint/i);
  });

  it('rejects a colour interpolation method instead of storing it as a stop', () => {
    // The bug this test exists for: `in oklab` used to become a stop called "in oklab",
    // and the editor then wrote a gradient nobody asked for.
    expect(reason('linear-gradient(in oklab, red, blue)')).toMatch(/interpolation method/i);
    expect(reason('linear-gradient(45deg in oklab, red, blue)')).toMatch(/interpolation method/i);
    expect(reason('conic-gradient(from 0deg in hsl longer hue, red, blue)')).toMatch(
      /interpolation method/i,
    );
    expect(parse('linear-gradient(in oklab, red, blue)')).toBeNull();
  });

  it('rejects computed values anywhere in the declaration', () => {
    expect(reason('linear-gradient(calc(45deg), red, blue)')).toMatch(/calc\(\)/i);
    expect(reason('linear-gradient(90deg, var(--brand), blue)')).toMatch(/var\(\)/i);
    expect(reason('linear-gradient(90deg, red calc(10% + 2px), blue)')).toMatch(/calc\(\)/i);
    expect(parse('linear-gradient(calc(45deg), red, blue)')).toBeNull();
  });

  it('rejects a stack of background layers rather than parsing the first one', () => {
    expect(
      reason('linear-gradient(90deg, red, blue), linear-gradient(0deg, black, white)'),
    ).toMatch(/one gradient at a time/i);
    expect(reason('background: linear-gradient(90deg, red, blue), url(paper.png);')).toMatch(
      /one gradient at a time/i,
    );
  });

  it('rejects anything trailing the gradient function', () => {
    expect(reason('linear-gradient(90deg, red, blue) no-repeat')).toMatch(/unexpected value/i);
    expect(reason('linear-gradient(90deg, red, blue')).toMatch(/unbalanced/i);
  });

  it('rejects unknown tokens instead of gluing them into a colour', () => {
    expect(reason('linear-gradient(90deg, red, blue 50% nonsense)')).toMatch(/not a colour/i);
    expect(reason('conic-gradient(gibberish!, red, blue)')).toMatch(/not a colour/i);
    expect(reason('radial-gradient(circle wonky, red, blue)')).toMatch(/radial shape/i);
    expect(reason('linear-gradient(to nowhere, red, blue)')).toMatch(/direction keyword/i);
  });

  it('rejects a value that is not a gradient at all', () => {
    expect(reason('url(cat.png)')).toMatch(/not a gradient/i);
    expect(reason('')).toMatch(/paste a gradient/i);
    expect(reason('linear-gradient(90deg, red)')).toMatch(/at least two colour stops/i);
  });

  it('gives every rejection a reason the UI can print', () => {
    const bad = [
      '',
      'url(cat.png)',
      'linear-gradient(in oklab, red, blue)',
      'linear-gradient(calc(45deg), red, blue)',
      'linear-gradient(90deg, red 0px, blue 100px)',
      'linear-gradient(90deg, red, blue), linear-gradient(0deg, black, white)',
    ];
    for (const input of bad) {
      const result = parseGradient(input);
      expect(result.ok, input).toBe(false);
      expect(reason(input).length, input).toBeGreaterThan(20);
    }
  });

  it('tags every rejection with a code and the values in the sentence', () => {
    const failure = (input: string) => {
      const result = parseGradient(input);
      return result.ok ? null : { code: result.code, params: result.params };
    };
    expect(failure('')).toEqual({ code: 'emptyInput', params: undefined });
    expect(failure('url(cat.png)')?.code).toBe('notGradient');
    expect(failure('linear-gradient(in oklab, red, blue)')?.code).toBe('interpolationMethod');
    expect(failure('linear-gradient(calc(45deg), red, blue)')).toEqual({
      code: 'computedValue',
      params: { fn: 'calc' },
    });
    expect(failure('linear-gradient(90deg, red 0px, blue 100px)')).toEqual({
      code: 'lengthPosition',
      params: { token: '0px' },
    });
    expect(failure('linear-gradient(90deg, red, blue 50% nonsense)')).toEqual({
      code: 'notColor',
      params: { color: 'blue nonsense' },
    });
    expect(failure('linear-gradient(to nowhere, red, blue)')).toEqual({
      code: 'unknownDirection',
      params: { head: 'to nowhere' },
    });
    expect(failure('radial-gradient(circle wonky, red, blue)')?.code).toBe('radialShape');
    expect(failure('linear-gradient(90deg, red)')?.code).toBe('tooFewStops');
    expect(failure('linear-gradient(90deg, red, blue')?.code).toBe('unbalanced');
  });

  it('still passes an unknown single word through as a colour name', () => {
    // The parser has no table of the 148 named colours, so a word it does not know is
    // treated as one. The browser will simply not paint it — the same outcome as typing
    // it into the colour field, and nothing is silently rewritten.
    expect(parse('linear-gradient(90deg, blurple, blue)')).toMatchObject({
      stops: [
        { color: 'blurple', position: null },
        { color: 'blue', position: null },
      ],
    });
  });
});
