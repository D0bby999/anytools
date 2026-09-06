/**
 * Canvas drawing for watermark-image — the half of logic.ts that needs a real `<canvas>` and so
 * cannot run under happy-dom (see ../shared/canvas-image.test.ts for the same limitation).
 * Verified by hand in the browser lane; geometry.ts carries everything that IS unit-tested.
 */
import { ImageToolError, type OutputFormat } from '../shared/canvas-image';
import {
  type WatermarkOptions,
  imageMarkSize,
  markCenter,
  textFontSizePx,
  tileCenters,
} from './geometry';

export type ResolvedMark =
  | { kind: 'text'; text: string; color: string; fontSizePx: number }
  | { kind: 'image'; bitmap: ImageBitmap; width: number; height: number };

/** Build the resolved mark for one target image. `logo` is required and decoded once per batch
 * when `opts.kind === 'image'` — never re-decoded per file. */
export function resolveMark(
  opts: WatermarkOptions,
  canvasWidth: number,
  logo?: ImageBitmap,
): ResolvedMark {
  if (opts.kind === 'text') {
    return {
      kind: 'text',
      text: opts.text,
      color: opts.color,
      fontSizePx: textFontSizePx(canvasWidth, opts.sizePercent),
    };
  }
  const logoBitmap = logo as ImageBitmap;
  const size = imageMarkSize(canvasWidth, opts.scalePercent, logoBitmap.width, logoBitmap.height);
  return { kind: 'image', bitmap: logoBitmap, ...size };
}

function markDimensions(
  ctx: CanvasRenderingContext2D,
  mark: ResolvedMark,
): { width: number; height: number } {
  if (mark.kind === 'image') return { width: mark.width, height: mark.height };
  ctx.font = `${mark.fontSizePx}px sans-serif`;
  return { width: ctx.measureText(mark.text).width, height: mark.fontSizePx };
}

function drawMarkAt(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  mark: ResolvedMark,
  dims: { width: number; height: number },
  rotation: number,
  opacity: number,
): void {
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(cx, cy);
  ctx.rotate((rotation * Math.PI) / 180);
  if (mark.kind === 'text') {
    ctx.font = `${mark.fontSizePx}px sans-serif`;
    ctx.fillStyle = mark.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(mark.text, 0, 0);
  } else {
    ctx.drawImage(mark.bitmap, -dims.width / 2, -dims.height / 2, dims.width, dims.height);
  }
  ctx.restore();
}

/**
 * Draw the base image plus the mark onto a canvas and encode it. `size` overrides the canvas
 * dimensions — the live preview renders at a capped size for speed; the real export omits it
 * and draws at the bitmap's own (already EXIF-corrected, ceiling-capped) resolution.
 */
export function renderWatermarked(
  bitmap: ImageBitmap,
  mark: ResolvedMark,
  opts: WatermarkOptions,
  format: OutputFormat,
  size?: { width: number; height: number },
): Promise<Blob> {
  const width = size?.width ?? bitmap.width;
  const height = size?.height ?? bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new ImageToolError(
      'noCanvasContext',
      'Your browser did not provide a 2D canvas context.',
    );
  }
  ctx.imageSmoothingQuality = 'high';
  // JPEG has no alpha channel; an unfilled canvas encodes transparent pixels as black.
  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);

  const dims = markDimensions(ctx, mark);
  if (opts.tile) {
    for (const c of tileCenters(dims.width, dims.height, width, height)) {
      drawMarkAt(ctx, c.x, c.y, mark, dims, opts.rotation, opts.opacity);
    }
  } else {
    const c = markCenter(opts.position, width, height, dims.width, dims.height);
    drawMarkAt(ctx, c.x, c.y, mark, dims, opts.rotation, opts.opacity);
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) return resolve(blob);
        const label = format.toUpperCase();
        reject(
          new ImageToolError('encodeFailed', `Your browser could not encode ${label}.`, {
            format: label,
          }),
        );
      },
      `image/${format}`,
      opts.quality,
    );
  });
}
