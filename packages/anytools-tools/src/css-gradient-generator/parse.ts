/**
 * CSS gradient text -> state. Implemented from the specs, not ported:
 * https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/linear-gradient
 * https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/radial-gradient
 * https://developer.mozilla.org/en-US/docs/Web/CSS/gradient/conic-gradient
 *
 * The rule here is: refuse anything the state cannot hold, and say why. An earlier
 * version accepted `linear-gradient(in oklab, red, blue)` by turning the colour-space
 * keyword into a stop named "in oklab", and `calc(45deg)` into a stop as well. Silently
 * rewriting the value is worse than an error, because the editor then shows a gradient
 * the author never wrote and copying it back replaces working CSS.
 */
import type {
  ColorStop,
  Common,
  GradientKind,
  GradientState,
  RadialShape,
  RadialSize,
} from './logic';

export type ParseResult = { ok: true; state: GradientState } | { ok: false; reason: string };

type Res<T> = { ok: true; value: T } | { ok: false; reason: string };

const ok = <T>(value: T): Res<T> => ({ ok: true, value });
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

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

/** Values the browser computes at paint time; there is no fixed number to put in a field. */
const COMPUTED = /\b(calc|var|env|clamp|min|max|attr)\s*\(/i;
/** `in oklab`, `in hsl longer hue` — a colour-interpolation method, not a colour. */
const INTERPOLATION = /(^|\s)in\s+[a-z][a-z0-9-]*/i;
const COLOR_FUNCTIONS = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
  'color-mix',
]);
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
/** A bare keyword: a named colour, `transparent` or `currentColor`. */
const COLOR_KEYWORD = /^[a-z][a-z-]*$/i;

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

/** Index of the `)` that closes the `(` at `open`, or -1 when the value is unbalanced. */
function matchingParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
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

/**
 * A colour is one token: a hex triplet, a known colour function, or a keyword. CSS has
 * no space-separated colour syntax outside brackets, so anything that arrives as two
 * words (`in oklab`, `no-repeat`) is not a colour and must not become one.
 */
function isColorToken(token: string): boolean {
  if (HEX.test(token)) return true;
  const fn = /^([a-z][a-z-]*)\([\s\S]*\)$/i.exec(token);
  if (fn?.[1]) return COLOR_FUNCTIONS.has(fn[1].toLowerCase());
  return COLOR_KEYWORD.test(token);
}

/** One stop entry; a double-position stop (`red 10% 40%`) expands to two stops. */
function parseStop(text: string): Res<ColorStop[]> {
  const positions: number[] = [];
  const colorParts: string[] = [];
  for (const token of splitOutsideParens(text, /\s/)) {
    const p = /^(-?[\d.]+)%$/.exec(token);
    if (p?.[1]) positions.push(Number.parseFloat(p[1]));
    // A stop position in px/em/rem cannot be stored as a percentage; refuse rather
    // than silently glue it onto the colour (`red 0px` is not a colour).
    else if (/^[-.\d]/.test(token))
      return fail(
        `Stop positions have to be percentages — "${token}" is a length this editor cannot store.`,
      );
    else colorParts.push(token);
  }
  if (colorParts.length === 0)
    return fail(
      `"${text}" is an interpolation hint (a bare percentage between two stops), which this editor cannot represent.`,
    );
  const color = colorParts.join(' ');
  if (colorParts.length > 1 || !isColorToken(color))
    return fail(`Not a colour this editor understands: "${color}".`);
  if (positions.length > 2)
    return fail(`A colour stop takes at most two positions; "${text}" has ${positions.length}.`);
  if (positions.length === 0) return ok([{ color, position: null }]);
  return ok(positions.map((position) => ({ color, position })));
}

function parseCenter(tokens: string[]): Res<{ cx: number; cy: number }> {
  const bad = fail('The centre has to be given as percentages or `center`.');
  if (tokens.length === 0 || tokens.length > 2) return bad;
  const cx = toPercent(tokens[0] as string);
  const cy = tokens.length === 2 ? toPercent(tokens[1] as string) : 50;
  return cx === null || cy === null ? bad : ok({ cx, cy });
}

/** Full result, with a sentence the UI can show. `parse` below is the null-returning form. */
export function parseGradient(input: string): ParseResult {
  const src = input
    .trim()
    .replace(/^background(-image)?\s*:\s*/i, '')
    .replace(/;\s*$/, '')
    .trim();
  if (!src) return fail('Paste a gradient value, or a whole `background:` declaration.');

  const computed = COMPUTED.exec(src);
  if (computed)
    return fail(
      `${computed[1]}() is resolved by the browser, so there is no fixed value for this editor to show.`,
    );

  const opener = /^(repeating-)?(linear|radial|conic)-gradient\s*\(/i.exec(src);
  if (!opener?.[2])
    return fail(
      'Not a gradient — expected linear-gradient(), radial-gradient() or conic-gradient().',
    );
  const openIndex = opener[0].length - 1;
  const closeIndex = matchingParen(src, openIndex);
  if (closeIndex === -1) return fail('Unbalanced brackets — the gradient is never closed.');
  const tail = src.slice(closeIndex + 1).trim();
  if (tail.startsWith(','))
    return fail(
      'One gradient at a time — this editor cannot hold a stack of comma-separated background layers.',
    );
  if (tail) return fail(`Unexpected value after the gradient: "${tail}".`);

  const repeating = Boolean(opener[1]);
  const kind = opener[2].toLowerCase() as GradientKind;
  const parts = splitOutsideParens(src.slice(openIndex + 1, closeIndex), /,/);
  const head = parts[0] ?? '';
  if (INTERPOLATION.test(head))
    return fail(
      'A colour interpolation method (`in oklab`, `in hsl longer hue`) changes how colours blend and cannot be stored here.',
    );

  const finish = (rest: string[], build: (common: Common) => GradientState): ParseResult => {
    const stops: ColorStop[] = [];
    for (const part of rest) {
      const parsed = parseStop(part);
      if (!parsed.ok) return parsed;
      stops.push(...parsed.value);
    }
    if (stops.length < 2) return fail('A gradient needs at least two colour stops.');
    return { ok: true, state: build({ repeating, stops }) };
  };

  if (kind === 'linear') {
    let angle = 180; // CSS default direction: to bottom
    let rest = parts;
    if (/^to\s/i.test(head)) {
      const side = SIDE_ANGLES[head.toLowerCase().split(/\s+/).slice(1).sort().join(' ')];
      if (side === undefined) return fail(`Unknown direction keyword: "${head}".`);
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
  if (kind === 'radial' && !geometry && /^[-.\d]/.test(head))
    return fail(
      'Explicit radii (`radial-gradient(200px 100px at …)`) cannot be stored as percentages — use a size keyword such as `farthest-corner`.',
    );
  const tokens = geometry ? splitOutsideParens(head, /\s/) : [];
  const rest = geometry ? parts.slice(1) : parts;
  const atIndex = tokens.findIndex((t) => t.toLowerCase() === 'at');
  const center = atIndex === -1 ? ok({ cx: 50, cy: 50 }) : parseCenter(tokens.slice(atIndex + 1));
  if (!center.ok) return center;
  const before = atIndex === -1 ? tokens : tokens.slice(0, atIndex);

  if (kind === 'conic') {
    let angle = 0;
    if (before.length > 0) {
      if (before.length !== 2 || before[0]?.toLowerCase() !== 'from')
        return fail(
          'Only `from <angle>` and `at <position>` can come before the stops of a conic gradient.',
        );
      const deg = toDeg(before[1] as string);
      if (deg === null) return fail(`Not an angle: "${before[1]}".`);
      angle = deg;
    }
    return finish(rest, (c) => ({ ...c, kind: 'conic', angle, ...center.value }));
  }

  let shape: RadialShape = 'ellipse';
  let size: RadialSize = 'farthest-corner';
  for (const token of before) {
    const lower = token.toLowerCase();
    if (lower === 'circle' || lower === 'ellipse') shape = lower;
    else if ((RADIAL_SIZES as string[]).includes(lower)) size = lower as RadialSize;
    // Explicit radii (`radial-gradient(200px 100px at …)`) are not representable here.
    else
      return fail(
        `Not a radial shape or size this editor supports: "${token}". Use circle/ellipse with one of ${RADIAL_SIZES.join(', ')}.`,
      );
  }
  return finish(rest, (c) => ({ ...c, kind: 'radial', shape, size, ...center.value }));
}

/** Convenience form for call sites that only branch on success. */
export function parse(input: string): GradientState | null {
  const result = parseGradient(input);
  return result.ok ? result.state : null;
}
