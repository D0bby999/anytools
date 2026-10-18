/**
 * `box-shadow` layer list <-> CSS text. Implemented from the property definition:
 * https://developer.mozilla.org/en-US/docs/Web/CSS/box-shadow
 *
 * Order matters and is preserved verbatim: the first layer paints on top of the
 * second, and so on. That is why the presets read "smallest, tightest layer first".
 */
import { hexToRgb, rgbToHex } from '../color-converter/logic';

export type ShadowLayer = {
  /** Horizontal offset in px; positive moves the shadow right. */
  x: number;
  /** Vertical offset in px; positive moves the shadow down. */
  y: number;
  /** Blur radius in px. Never negative — the CSS is invalid and drops the whole list. */
  blur: number;
  /** Spread in px; negative shrinks the shadow before blurring. */
  spread: number;
  color: string;
  /** Inset shadows paint inside the border box instead of outside it. */
  inset: boolean;
};

export const DEFAULT_LAYER: ShadowLayer = {
  x: 0,
  y: 4,
  blur: 12,
  spread: 0,
  color: 'rgba(0, 0, 0, 0.15)',
  inset: false,
};

/**
 * A layer as the editor holds it. React needs a key that survives an edit: keying a
 * layer row by `layer.color` (what this tool shipped with) remounted the row on every
 * keystroke and on every step of the alpha slider, so the colour field lost focus after
 * one character and the slider let go of the thumb. The index is no good either —
 * removing a layer would shift every key below it. The id stays out of `ShadowLayer`
 * so the CSS model keeps holding only what CSS has.
 */
export type LayerRow = ShadowLayer & { id: string };

let counter = 0;

/** Ids only have to be unique inside one list; a module counter is enough for that. */
export function makeLayerRow(layer: ShadowLayer): LayerRow {
  counter += 1;
  return { ...layer, id: `layer-${counter}` };
}

export function makeLayerRows(layers: readonly ShadowLayer[]): LayerRow[] {
  return layers.map(makeLayerRow);
}

/** Edit one row in place. The id is kept, which is the whole point of these helpers. */
export function updateLayerRow(
  rows: LayerRow[],
  index: number,
  patch: Partial<ShadowLayer>,
): LayerRow[] {
  return rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
}

export function removeLayerRow(rows: LayerRow[], index: number): LayerRow[] {
  return rows.filter((_, i) => i !== index);
}

export function layerToCss(layer: ShadowLayer): string {
  const parts = [`${layer.x}px`, `${layer.y}px`, `${Math.max(0, layer.blur)}px`];
  // Spread is optional in the syntax; omitting the zero keeps the common case short.
  if (layer.spread !== 0) parts.push(`${layer.spread}px`);
  parts.push(layer.color);
  if (layer.inset) parts.unshift('inset');
  return parts.join(' ');
}

/** The value only. `none` when there is nothing to paint — an empty value is invalid CSS. */
export function toCss(layers: ShadowLayer[]): string {
  return layers.length === 0 ? 'none' : layers.map(layerToCss).join(', ');
}

/** The full declaration, wrapped one layer per line once it stops fitting on one. */
export function toCssBlock(layers: ShadowLayer[]): string {
  const value = toCss(layers);
  if (layers.length < 2) return `box-shadow: ${value};`;
  return `box-shadow:\n${layers.map((l) => `  ${layerToCss(l)}`).join(',\n')};`;
}

/** Tailwind arbitrary value. Spaces become underscores, per Tailwind's own syntax. */
export function toTailwind(layers: ShadowLayer[]): string {
  return `shadow-[${toCss(layers).replace(/\s+/g, '_')}]`;
}

/**
 * Split a layer colour into the two things the editor can show: a `#rrggbb` swatch and
 * an alpha slider. Shadows are nearly always translucent, and `<input type="color">`
 * has no alpha channel, so the two have to be edited separately. Hex parsing is
 * color-converter's, so `#abc`, `abc` and `#AABBCC` all behave the same here.
 */
export function splitColor(color: string): { hex: string; alpha: number } {
  const fn =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(
      color.trim(),
    );
  if (fn) {
    const channel = (v: string) => Math.max(0, Math.min(255, Math.round(Number(v))));
    const raw = fn[4] === undefined ? 1 : Number(fn[4]) / (fn[5] === '%' ? 100 : 1);
    const rgb = {
      r: channel(fn[1] as string),
      g: channel(fn[2] as string),
      b: channel(fn[3] as string),
    };
    return {
      hex: rgbToHex(rgb).toLowerCase(),
      alpha: Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1,
    };
  }
  const rgb = hexToRgb(color.trim());
  return rgb ? { hex: rgbToHex(rgb).toLowerCase(), alpha: 1 } : { hex: '#000000', alpha: 1 };
}

/** Inverse of `splitColor`: opaque colours stay hex, translucent ones become rgba(). */
export function joinColor(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex) ?? { r: 0, g: 0, b: 0 };
  if (alpha >= 1) return rgbToHex(rgb).toLowerCase();
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Number(alpha.toFixed(2))})`;
}
