/**
 * CSS gradient state -> CSS text. Implemented from the specs, not ported:
 * https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/linear-gradient
 * https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/radial-gradient
 * https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/conic-gradient
 *
 * The state is a discriminated union on purpose: a flat object would carry radial
 * fields on a linear gradient, which `toCss` cannot emit, so `parse(toCss(s))` could
 * never return them. As written, `parse(toCss(s))` deep-equals `s` for every state
 * this module can build — that is what makes "paste your CSS back in and edit it" work.
 *
 * The other direction (CSS text -> state) lives in `parse.ts`; identity for editor rows
 * lives in `stop-rows.ts`. Neither belongs in the value model: `ColorStop` stays exactly
 * what CSS has, so the round trip above can compare states with a deep equality check.
 */

export type GradientKind = 'linear' | 'radial' | 'conic';
export type RadialShape = 'circle' | 'ellipse';
export type RadialSize = 'closest-side' | 'closest-corner' | 'farthest-side' | 'farthest-corner';

/** `position` is a percentage; `null` means "let the browser distribute it evenly". */
export type ColorStop = { color: string; position: number | null };

export type Common = { repeating: boolean; stops: ColorStop[] };
export type LinearGradient = Common & { kind: 'linear'; angle: number };
export type RadialGradient = Common & {
  kind: 'radial';
  shape: RadialShape;
  size: RadialSize;
  cx: number;
  cy: number;
};
export type ConicGradient = Common & { kind: 'conic'; angle: number; cx: number; cy: number };
export type GradientState = LinearGradient | RadialGradient | ConicGradient;

function stopToCss(stop: ColorStop): string {
  return stop.position === null ? stop.color : `${stop.color} ${stop.position}%`;
}

export function toCss(g: GradientState): string {
  const fn = `${g.repeating ? 'repeating-' : ''}${g.kind}-gradient`;
  const stops = g.stops.map(stopToCss).join(', ');
  if (g.kind === 'linear') return `${fn}(${g.angle}deg, ${stops})`;
  if (g.kind === 'radial') return `${fn}(${g.shape} ${g.size} at ${g.cx}% ${g.cy}%, ${stops})`;
  return `${fn}(from ${g.angle}deg at ${g.cx}% ${g.cy}%, ${stops})`;
}

/** Declaration block with a flat-colour fallback line for engines without gradients. */
export function toCssBlock(g: GradientState): string {
  return `background: ${g.stops[0]?.color ?? 'transparent'};\nbackground: ${toCss(g)};`;
}

/** Tailwind arbitrary value — spaces become underscores, per Tailwind's own syntax. */
export function toTailwind(g: GradientState): string {
  return `bg-[${toCss(g).replace(/\s+/g, '_')}]`;
}

/** Switch gradient kind, keeping the stops and whatever geometry still applies. */
export function withKind(g: GradientState, kind: GradientKind): GradientState {
  const common: Common = { repeating: g.repeating, stops: g.stops };
  const angle = 'angle' in g ? g.angle : 90;
  const cx = 'cx' in g ? g.cx : 50;
  const cy = 'cy' in g ? g.cy : 50;
  if (kind === 'linear') return { ...common, kind, angle };
  if (kind === 'conic') return { ...common, kind, angle, cx, cy };
  return { ...common, kind, shape: 'circle', size: 'farthest-corner', cx, cy };
}

/**
 * Where each stop sits on the editor track, in percent. A stop with no position is
 * spaced evenly between the neighbours that have one, which is what the browser does;
 * the first and last default to 0% and 100%.
 *
 * Stops that run backwards (`red 60%, blue 20%`) are left where they were written —
 * the browser clamps them up when painting, but the editor shows the number you typed,
 * so the handle and the position field never disagree.
 */
export function trackPositions(stops: readonly ColorStop[]): number[] {
  const out: (number | null)[] = stops.map((s) => s.position);
  if (out.length === 0) return [];
  if (out[0] === null) out[0] = 0;
  if (out[out.length - 1] === null) out[out.length - 1] = 100;
  for (let i = 1; i < out.length; i += 1) {
    if (out[i] !== null) continue;
    let end = i;
    while (out[end] === null) end += 1;
    const from = out[i - 1] as number;
    const to = out[end] as number;
    const steps = end - i + 1;
    for (let k = i; k < end; k += 1) out[k] = from + ((to - from) * (k - i + 1)) / steps;
    i = end - 1;
  }
  return out as number[];
}

/** Where a pointer at `clientX` lands on a track, as 0–100 rounded to one decimal. */
export function pointerPercent(clientX: number, rect: { left: number; width: number }): number {
  if (rect.width <= 0) return 0;
  const raw = ((clientX - rect.left) / rect.width) * 100;
  return Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10;
}
