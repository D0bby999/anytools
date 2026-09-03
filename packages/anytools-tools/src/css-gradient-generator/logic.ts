/**
 * CSS gradient state <-> CSS text. Implemented from the specs, not ported:
 * https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/linear-gradient
 * https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/radial-gradient
 * https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/conic-gradient
 *
 * The state is a discriminated union on purpose: a flat object would carry radial
 * fields on a linear gradient, which `toCss` cannot emit, so `parse(toCss(s))` could
 * never return them. As written, `parse(toCss(s))` deep-equals `s` for every state
 * this module can build — that is what makes "paste your CSS back in and edit it" work.
 */

export type GradientKind = 'linear' | 'radial' | 'conic';
export type RadialShape = 'circle' | 'ellipse';
export type RadialSize = 'closest-side' | 'closest-corner' | 'farthest-side' | 'farthest-corner';

/** `position` is a percentage; `null` means "let the browser distribute it evenly". */
export type ColorStop = { color: string; position: number | null };

type Common = { repeating: boolean; stops: ColorStop[] };
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

const RADIAL_SIZES: RadialSize[] = [
  'closest-side',
  'closest-corner',
  'farthest-side',
  'farthest-corner',
];

/**
 * `to top right` is not a fixed angle in CSS — the real angle depends on the box
 * aspect ratio. We map the corner keywords to the square-box angle, which is what a
 * generator can round-trip; the emitted CSS always uses the explicit degree value.
 */
const SIDE_ANGLES: Record<string, number> = {
  top: 0,
  right: 90,
  bottom: 180,
  left: 270,
  'right top': 45,
  'bottom right': 135,
  'bottom left': 225,
  'left top': 315,
};

function splitOutsideParens(src: string, sep: RegExp): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of src) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (depth === 0 && sep.test(ch)) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function toDeg(token: string): number | null {
  const m = /^(-?[\d.]+)(deg|grad|rad|turn)$/i.exec(token.trim());
  if (!m?.[1] || !m[2]) return null;
  const n = Number.parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'grad') return (n * 360) / 400;
  if (unit === 'rad') return (n * 180) / Math.PI;
  if (unit === 'turn') return n * 360;
  return n;
}

function toPercent(token: string): number | null {
  if (token.toLowerCase() === 'center') return 50;
  const m = /^(-?[\d.]+)%$/.exec(token);
  return m?.[1] ? Number.parseFloat(m[1]) : null;
}

/** One stop entry; a double-position stop (`red 10% 40%`) expands to two stops. */
function parseStop(text: string): ColorStop[] | null {
  const positions: number[] = [];
  const colorParts: string[] = [];
  for (const token of splitOutsideParens(text, /\s/)) {
    const p = /^(-?[\d.]+)%$/.exec(token);
    if (p?.[1]) positions.push(Number.parseFloat(p[1]));
    // A stop position in px/em/rem cannot be stored as a percentage; refuse rather
    // than silently glue it onto the colour (`red 0px` is not a colour).
    else if (/^[-.\d]/.test(token)) return null;
    else colorParts.push(token);
  }
  const color = colorParts.join(' ');
  // A bare percentage between two stops is an interpolation hint, not a stop.
  if (!color || positions.length > 2) return null;
  if (positions.length === 0) return [{ color, position: null }];
  return positions.map((position) => ({ color, position }));
}

function parseCenter(tokens: string[]): { cx: number; cy: number } | null {
  if (tokens.length === 0 || tokens.length > 2) return null;
  const cx = toPercent(tokens[0] as string);
  const cy = tokens.length === 2 ? toPercent(tokens[1] as string) : 50;
  return cx === null || cy === null ? null : { cx, cy };
}

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

export function parse(input: string): GradientState | null {
  const src = input
    .trim()
    .replace(/^background(-image)?\s*:\s*/i, '')
    .replace(/;\s*$/, '')
    .trim();
  const m = /^(repeating-)?(linear|radial|conic)-gradient\s*\(([\s\S]*)\)$/i.exec(src);
  if (!m?.[2] || m[3] === undefined) return null;
  const repeating = Boolean(m[1]);
  const kind = m[2].toLowerCase() as GradientKind;
  const parts = splitOutsideParens(m[3], /,/);
  const head = parts[0] ?? '';

  const finish = (
    rest: string[],
    build: (common: Common) => GradientState,
  ): GradientState | null => {
    const stops: ColorStop[] = [];
    for (const part of rest) {
      const parsed = parseStop(part);
      if (!parsed) return null;
      stops.push(...parsed);
    }
    return stops.length >= 2 ? build({ repeating, stops }) : null;
  };

  if (kind === 'linear') {
    let angle = 180; // CSS default direction: to bottom
    let rest = parts;
    if (/^to\s/i.test(head)) {
      const side = SIDE_ANGLES[head.toLowerCase().split(/\s+/).slice(1).sort().join(' ')];
      if (side === undefined) return null;
      angle = side;
      rest = parts.slice(1);
    } else {
      const deg = toDeg(head);
      if (deg !== null) {
        angle = deg;
        rest = parts.slice(1);
      }
    }
    return finish(rest, (c) => ({ ...c, kind: 'linear', angle }));
  }

  // The first comma-part is geometry only when it starts with a geometry keyword;
  // otherwise it is already the first colour stop (`radial-gradient(red, blue)`).
  const geometry =
    kind === 'conic'
      ? /^(from|at)\b/i.test(head)
      : /^(circle|ellipse|closest-|farthest-|at)\b/i.test(head);
  const tokens = geometry ? splitOutsideParens(head, /\s/) : [];
  const rest = geometry ? parts.slice(1) : parts;
  const atIndex = tokens.findIndex((t) => t.toLowerCase() === 'at');
  const center = atIndex === -1 ? { cx: 50, cy: 50 } : parseCenter(tokens.slice(atIndex + 1));
  if (!center) return null;
  const before = atIndex === -1 ? tokens : tokens.slice(0, atIndex);

  if (kind === 'conic') {
    let angle = 0;
    if (before.length > 0) {
      if (before.length !== 2 || before[0]?.toLowerCase() !== 'from') return null;
      const deg = toDeg(before[1] as string);
      if (deg === null) return null;
      angle = deg;
    }
    return finish(rest, (c) => ({ ...c, kind: 'conic', angle, ...center }));
  }

  let shape: RadialShape = 'ellipse';
  let size: RadialSize = 'farthest-corner';
  for (const token of before) {
    const lower = token.toLowerCase();
    if (lower === 'circle' || lower === 'ellipse') shape = lower;
    else if ((RADIAL_SIZES as string[]).includes(lower)) size = lower as RadialSize;
    // Explicit radii (`radial-gradient(200px 100px at …)`) are not representable here.
    else return null;
  }
  return finish(rest, (c) => ({ ...c, kind: 'radial', shape, size, ...center }));
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
