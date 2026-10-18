/**
 * Pure placement math and shared option types for watermark-image — no canvas, no DOM, unit-
 * tested directly. Split out of logic.ts to keep that file under the repo's 200-line budget
 * (see ../heic-to-jpg/decode.ts for the same pattern: heavy/pure logic in its own module,
 * orchestration in `logic.ts`). Types live here rather than in logic.ts so both this module and
 * render.ts can depend on them without a circular import.
 */
import type { OutputFormat } from '../shared/canvas-image';

export type GridPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type WatermarkPosition =
  | { kind: 'grid'; grid: GridPosition }
  | { kind: 'custom'; xPercent: number; yPercent: number };

type MarkKind =
  | { kind: 'text'; text: string; color: string; sizePercent: number }
  | { kind: 'image'; scalePercent: number };

export type FormatChoice = 'original' | OutputFormat;

export type WatermarkOptions = MarkKind & {
  position: WatermarkPosition;
  opacity: number;
  rotation: number;
  tile: boolean;
  format: FormatChoice;
  quality: number;
};

/** How far a grid position keeps from the edge, as a percent of the shorter side. */
const MARGIN_PERCENT = 4;

/** Font size for a text mark, relative to the image so a batch of mixed resolutions all get a
 * visually comparable watermark rather than a fixed pixel size that is tiny on a 6000px photo. */
export function textFontSizePx(canvasWidth: number, sizePercent: number): number {
  return Math.max(8, Math.round((canvasWidth * sizePercent) / 100));
}

/** Pixel box for a logo mark, preserving its aspect ratio. */
export function imageMarkSize(
  canvasWidth: number,
  scalePercent: number,
  logoWidth: number,
  logoHeight: number,
): { width: number; height: number } {
  const width = Math.max(1, Math.round((canvasWidth * scalePercent) / 100));
  return { width, height: Math.max(1, Math.round((width * logoHeight) / logoWidth)) };
}

/** Center of a mark box for a 9-cell grid position or a free (x%, y%) position. */
export function markCenter(
  position: WatermarkPosition,
  canvasWidth: number,
  canvasHeight: number,
  markWidth: number,
  markHeight: number,
): { x: number; y: number } {
  if (position.kind === 'custom') {
    return {
      x: (canvasWidth * position.xPercent) / 100,
      y: (canvasHeight * position.yPercent) / 100,
    };
  }
  const margin = (Math.min(canvasWidth, canvasHeight) * MARGIN_PERCENT) / 100;
  // Every GridPosition has exactly one hyphen ('top-left'..'bottom-right'), so a plain split
  // separates the vertical cell from the horizontal one.
  const [vert, horiz] = position.grid.split('-') as ['top' | 'middle' | 'bottom', string];
  const x =
    horiz === 'left'
      ? margin + markWidth / 2
      : horiz === 'right'
        ? canvasWidth - margin - markWidth / 2
        : canvasWidth / 2;
  const y =
    vert === 'top'
      ? margin + markHeight / 2
      : vert === 'bottom'
        ? canvasHeight - margin - markHeight / 2
        : canvasHeight / 2;
  return { x, y };
}

/**
 * Centers for every tile needed to cover the canvas, buffered so a rotated mark near an edge
 * is not clipped. The 1.8x step leaves visible gaps between repeats — a typical "tiled
 * watermark" look — rather than mark instances touching edge to edge.
 */
export function tileCenters(
  markWidth: number,
  markHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): Array<{ x: number; y: number }> {
  const stepX = markWidth * 1.8;
  const stepY = markHeight * 1.8;
  const buffer = Math.max(markWidth, markHeight);
  const centers: Array<{ x: number; y: number }> = [];
  for (let y = -buffer; y < canvasHeight + buffer; y += stepY) {
    for (let x = -buffer; x < canvasWidth + buffer; x += stepX) centers.push({ x, y });
  }
  return centers;
}
