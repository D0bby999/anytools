/**
 * The canvas half of the cutout: scaling the mask, hardening it, feathering it, encoding the PNG.
 *
 * Separated from logic.ts to keep that file inside the 200-line limit, and separated from
 * mask-math.ts because nothing here can be unit-tested — happy-dom's getContext returns null and
 * its toBlob never calls back. Everything in this file is exercised by the browser lane.
 */
import { ImageToolError } from '../shared/canvas-image';
import { MODEL_SIZE, applyThresholdInPlace, maskToRgba } from './mask-math';

export type Surface = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D };

/**
 * A canvas plus its 2D context, or a clear error.
 *
 * `willReadFrequently` matters here: every surface this tool makes is read back with
 * getImageData, and without the hint Chrome keeps the canvas on the GPU and each read stalls the
 * pipeline.
 */
export function surface(width: number, height: number): Surface {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new ImageToolError(
      'noCanvasContext',
      'Your browser did not provide a 2D canvas context.',
    );
  }
  return { canvas, ctx };
}

/**
 * Drop a canvas's backing store now instead of at the next garbage collection.
 *
 * A full-frame surface is width × height × 4 bytes of memory the JS heap does not account for, so
 * the collector is in no hurry to reclaim it; this tool holds several at once and an 8-megapixel
 * frame makes each of them 32 MB. Setting either dimension to 0 frees the buffer immediately, and
 * is the only way to say so from script.
 */
export function release(s: Surface): void {
  s.canvas.width = 0;
  s.canvas.height = 0;
}

/**
 * Scale the 320×320 mask up to the image's size, then threshold and feather it.
 *
 * Order matters: threshold first, blur second. Blurring a soft mask and then cutting it gives a
 * hard edge in a slightly different place; cutting first and blurring after is what produces the
 * soft border the "edge softness" control promises.
 *
 * Known limit: `ctx.filter` samples transparent black from outside the canvas, so a subject that
 * runs off the edge of the frame fades over the feather radius at that edge. At the default 1px
 * this is invisible; at 8px on a tight crop it is not.
 */
export function buildMask(
  mask: Float32Array,
  width: number,
  height: number,
  { threshold, feather }: { threshold: number; feather: number },
): ImageData {
  const small = surface(MODEL_SIZE, MODEL_SIZE);
  small.ctx.putImageData(new ImageData(maskToRgba(mask), MODEL_SIZE, MODEL_SIZE), 0, 0);

  const full = surface(width, height);
  full.ctx.imageSmoothingEnabled = true;
  full.ctx.imageSmoothingQuality = 'high';
  full.ctx.drawImage(small.canvas, 0, 0, full.canvas.width, full.canvas.height);
  release(small);

  const scaled = full.ctx.getImageData(0, 0, full.canvas.width, full.canvas.height);
  applyThresholdInPlace(scaled.data, threshold);
  if (!(feather > 0)) {
    release(full);
    return scaled;
  }

  full.ctx.putImageData(scaled, 0, 0);
  // A second surface, not a self-draw: drawing a canvas onto itself through ctx.filter is legal
  // per spec but has a history of browser bugs, and this path cannot be unit-tested. The cost is
  // one extra full-frame buffer for the length of one drawImage, freed on the next line.
  const blurred = surface(width, height);
  blurred.ctx.filter = `blur(${feather}px)`;
  blurred.ctx.drawImage(full.canvas, 0, 0);
  release(full);
  const out = blurred.ctx.getImageData(0, 0, blurred.canvas.width, blurred.canvas.height);
  release(blurred);
  return out;
}

/** Encode a canvas as PNG — the only common format that keeps an alpha channel. */
export async function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new ImageToolError('pngEncodeFailed', 'Your browser could not encode the PNG.');
  return blob;
}
