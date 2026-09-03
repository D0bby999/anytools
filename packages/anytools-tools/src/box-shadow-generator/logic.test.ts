import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYER,
  type ShadowLayer,
  joinColor,
  layerToCss,
  splitColor,
  toCss,
  toCssBlock,
  toTailwind,
} from './logic';
import { SHADOW_PRESETS } from './presets';

const l = (patch: Partial<ShadowLayer> = {}): ShadowLayer => ({ ...DEFAULT_LAYER, ...patch });

describe('layerToCss', () => {
  it('emits offsets and blur in px', () => {
    expect(layerToCss(l({ x: 1, y: 2, blur: 3, color: '#000' }))).toBe('1px 2px 3px #000');
  });

  it('omits a zero spread but keeps a non-zero one', () => {
    expect(layerToCss(l({ spread: 0, color: 'red' }))).toBe('0px 4px 12px red');
    expect(layerToCss(l({ spread: -3, color: 'red' }))).toBe('0px 4px 12px -3px red');
  });

  it('puts the inset keyword first', () => {
    expect(layerToCss(l({ inset: true, color: 'red' }))).toBe('inset 0px 4px 12px red');
  });

  it('clamps a negative blur, which would invalidate the whole declaration', () => {
    expect(layerToCss(l({ blur: -8, color: 'red' }))).toBe('0px 4px 0px red');
  });

  it('keeps negative offsets', () => {
    expect(layerToCss(l({ x: -6, y: -2, blur: 0, color: 'red' }))).toBe('-6px -2px 0px red');
  });
});

describe('toCss', () => {
  it('joins layers in order — the first one paints on top', () => {
    expect(toCss([l({ y: 1, blur: 2, color: 'red' }), l({ y: 9, blur: 20, color: 'blue' })])).toBe(
      '0px 1px 2px red, 0px 9px 20px blue',
    );
  });

  it('keeps the order stable across a three-layer preset', () => {
    const material = SHADOW_PRESETS.find((p) => p.name === 'Material 1');
    expect(toCss(material?.layers ?? [])).toBe(
      '0px 2px 1px -1px rgba(0, 0, 0, 0.2), 0px 1px 1px rgba(0, 0, 0, 0.14), 0px 1px 3px rgba(0, 0, 0, 0.12)',
    );
  });

  it('returns none rather than an empty, invalid value', () => {
    expect(toCss([])).toBe('none');
    expect(toCssBlock([])).toBe('box-shadow: none;');
  });

  it('mixes inset and outer layers in one list', () => {
    expect(toCss([l({ inset: true, color: 'red' }), l({ color: 'blue' })])).toBe(
      'inset 0px 4px 12px red, 0px 4px 12px blue',
    );
  });
});

describe('toCssBlock', () => {
  it('stays on one line for a single layer', () => {
    expect(toCssBlock([l({ color: 'red' })])).toBe('box-shadow: 0px 4px 12px red;');
  });

  it('breaks multi-layer values one per line', () => {
    expect(toCssBlock([l({ color: 'red' }), l({ color: 'blue' })])).toBe(
      'box-shadow:\n  0px 4px 12px red,\n  0px 4px 12px blue;',
    );
  });
});

describe('toTailwind', () => {
  it('escapes every space as an underscore', () => {
    expect(toTailwind([l({ color: '#000' })])).toBe('shadow-[0px_4px_12px_#000]');
  });

  it('never emits a raw space, even for multi-layer rgba presets', () => {
    for (const preset of SHADOW_PRESETS) {
      expect(toTailwind(preset.layers), preset.name).not.toMatch(/ /);
    }
  });
});

describe('splitColor / joinColor', () => {
  it('splits rgba() into a swatch and an alpha', () => {
    expect(splitColor('rgba(0, 0, 0, 0.14)')).toEqual({ hex: '#000000', alpha: 0.14 });
    expect(splitColor('rgb(255 128 0 / 50%)')).toEqual({ hex: '#ff8000', alpha: 0.5 });
    expect(splitColor('rgb(16, 24, 40)')).toEqual({ hex: '#101828', alpha: 1 });
  });

  it('accepts the short hex form, via color-converter', () => {
    expect(splitColor('#abc')).toEqual({ hex: '#aabbcc', alpha: 1 });
  });

  it('falls back to opaque black for anything it cannot read', () => {
    expect(splitColor('rebeccapurple')).toEqual({ hex: '#000000', alpha: 1 });
  });

  it('round-trips every preset colour', () => {
    for (const preset of SHADOW_PRESETS) {
      for (const layer of preset.layers) {
        const { hex, alpha } = splitColor(layer.color);
        expect(joinColor(hex, alpha), preset.name).toBe(layer.color);
      }
    }
  });

  it('emits hex when fully opaque and rgba() otherwise', () => {
    expect(joinColor('#101828', 1)).toBe('#101828');
    expect(joinColor('#101828', 0.25)).toBe('rgba(16, 24, 40, 0.25)');
  });
});

describe('presets', () => {
  it('has the Material and Tailwind families the tool advertises', () => {
    const names = SHADOW_PRESETS.map((p) => p.name);
    expect(names.filter((n) => n.startsWith('Material'))).toHaveLength(5);
    expect(names).toEqual(expect.arrayContaining(['Tailwind sm', 'Tailwind 2xl']));
  });

  it('has no negative blur anywhere — that would invalidate the declaration', () => {
    for (const preset of SHADOW_PRESETS) {
      for (const layer of preset.layers) expect(layer.blur, preset.name).toBeGreaterThanOrEqual(0);
    }
  });
});
