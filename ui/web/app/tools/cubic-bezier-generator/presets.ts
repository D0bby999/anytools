import type { CubicBezier } from './logic';

export type BezierPreset = { name: string; bezier: CubicBezier };

/**
 * The five CSS timing-function keywords, as their exact `cubic-bezier()` equivalents —
 * https://developer.mozilla.org/en-US/docs/Web/CSS/easing-function#keywords_for_common_cubic-bezier_easing_functions
 * (`linear` has no overshoot, but is still a cubic bezier with control points on the diagonal.)
 */
export const CSS_KEYWORD_PRESETS: BezierPreset[] = [
  { name: 'linear', bezier: { x1: 0, y1: 0, x2: 1, y2: 1 } },
  { name: 'ease', bezier: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } },
  { name: 'ease-in', bezier: { x1: 0.42, y1: 0, x2: 1, y2: 1 } },
  { name: 'ease-out', bezier: { x1: 0, y1: 0, x2: 0.58, y2: 1 } },
  { name: 'ease-in-out', bezier: { x1: 0.42, y1: 0, x2: 0.58, y2: 1 } },
];

/**
 * Overshoot presets — y1/y2 outside [0,1], which CSS allows (see logic.ts header). These are
 * the "back" easing curves published on https://easings.net (easeInBack/easeOutBack/
 * easeInOutBack), the standard bezier approximation of Robert Penner's original easing
 * equations; widely reused as-is by cubic-bezier.com and animation libraries.
 */
export const OVERSHOOT_PRESETS: BezierPreset[] = [
  { name: 'ease-in-back', bezier: { x1: 0.36, y1: 0, x2: 0.66, y2: -0.56 } },
  { name: 'ease-out-back', bezier: { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 } },
  { name: 'ease-in-out-back', bezier: { x1: 0.68, y1: -0.6, x2: 0.32, y2: 1.6 } },
];
