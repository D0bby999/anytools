/**
 * `cubic-bezier()` timing-function math. A CSS cubic-bezier easing is a curve from (0,0) to
 * (1,1) with two free control points P1=(x1,y1) and P2=(x2,y2); the X axis is elapsed time
 * (0 to 1) and the Y axis is animation progress.
 *
 * The spec requires x1 and x2 to stay in [0,1] — outside that range the curve is not a
 * function of time (X(u) could go backwards, so "progress at time t" would be ambiguous) and
 * browsers reject the whole declaration. Y has no such rule: CSS explicitly allows y1/y2
 * outside [0,1] to produce overshoot/bounce easing, so only x gets clamped here.
 * https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function/cubic-bezier
 */

export type CubicBezier = { x1: number; y1: number; x2: number; y2: number };
export type Point = { x: number; y: number };

/** CSS requires x1, x2 in [0,1]. Y is left untouched — see file header. */
export function clampX(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Format like the presets browsers ship: up to 3 decimals, no trailing zeros. */
function fmt(n: number): string {
  return Number.isFinite(n) ? Number(n.toFixed(3)).toString() : '0';
}

export function toCss(b: CubicBezier): string {
  return `cubic-bezier(${fmt(b.x1)}, ${fmt(b.y1)}, ${fmt(b.x2)}, ${fmt(b.y2)})`;
}

export function toTransitionTimingFunction(b: CubicBezier): string {
  return `transition-timing-function: ${toCss(b)};`;
}

export function toCssVariable(name: string, b: CubicBezier): string {
  return `--${name}: ${toCss(b)};`;
}

/** Cubic bezier value at parameter u, for one axis, with fixed endpoints 0 and 1. */
function axisAt(u: number, c1: number, c2: number): number {
  const v = 1 - u;
  return 3 * v * v * u * c1 + 3 * v * u * u * c2 + u * u * u;
}

/**
 * Solve X(u) = t for the bezier parameter u, by bisection. X(u) is guaranteed monotonic over
 * u in [0,1] because x1 and x2 are clamped to [0,1] (that constraint is exactly what makes the
 * curve invertible as a function of time — see file header). 30 halvings give ~1e-9 precision,
 * cheap enough to call every animation frame.
 */
function solveU(t: number, x1: number, x2: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (axisAt(mid, x1, x2) < t) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The eased progress (Y) at elapsed-time fraction `t` (0..1). This is what a live preview
 * animates with: it is the same "time in, progress out" mapping the CSS engine applies to a
 * `transition-timing-function`. Progress can be < 0 or > 1 when y1/y2 sit outside [0,1] — that
 * is the overshoot/anticipation look, not a bug.
 */
export function easingValueAt(t: number, b: CubicBezier): number {
  const clampedT = Math.min(1, Math.max(0, t));
  const u = solveU(clampedT, clampX(b.x1), clampX(b.x2));
  return axisAt(u, b.y1, b.y2);
}

/** A control point dragged on the grid: x clamped into [0,1], y left free (see header). */
export function clampControlPoint(p: Point): Point {
  return { x: clampX(p.x), y: p.y };
}

/** Parses a decimal typed into a number field; null for anything that is not a finite number. */
export function parseCoordinate(text: string): number | null {
  const n = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(n) ? n : null;
}
