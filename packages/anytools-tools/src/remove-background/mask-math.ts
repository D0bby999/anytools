/**
 * The arithmetic of the cutout, kept away from canvas and WASM so it can be tested for real.
 *
 * Every constant and every step below mirrors what `rembg` does around this exact model file
 * (rembg/sessions/base.py `normalize` and rembg/sessions/u2net.py `predict`, read 2026-09-03).
 * Matching it is not cargo-culting: u2netp was trained on inputs preprocessed this way, and a
 * plausible-looking deviation (dividing by 255 instead of the image maximum, say) shifts the
 * input distribution and quietly degrades every mask.
 */

/** u2netp takes a fixed 320×320 input. Not a tunable — the graph has this shape baked in. */
export const MODEL_SIZE = 320;

/** ImageNet channel statistics, as used by U-2-Net's own training transform. */
export const MEAN = [0.485, 0.456, 0.406] as const;
export const STD = [0.229, 0.224, 0.225] as const;

/**
 * RGBA pixels of the 320×320 input → NCHW float32 tensor data.
 *
 * Two details that are easy to get wrong and impossible to see in the output:
 *
 *   - The divisor is the image's own maximum channel value, not 255. rembg does
 *     `im_ary / max(np.max(im_ary), 1e-6)`, which stretches a dark photo up to full range before
 *     the mean/std step. The 1e-6 floor is what keeps an all-black image from producing NaNs.
 *   - The layout is channel-planar (all reds, then all greens, then all blues), not interleaved
 *     as the canvas hands it over. Interleaved data loads without error and returns noise.
 *
 * Alpha is dropped, as `img.convert("RGB")` does — including from the maximum, which is why the
 * loop steps over it.
 */
export function normaliseToTensor(rgba: Uint8ClampedArray | Uint8Array): Float32Array {
  if (rgba.length % 4 !== 0) throw new Error('normaliseToTensor: expected RGBA pixel data');
  const pixels = rgba.length / 4;

  let max = 0;
  for (let i = 0; i < pixels; i++) {
    const r = rgba[i * 4] as number;
    const g = rgba[i * 4 + 1] as number;
    const b = rgba[i * 4 + 2] as number;
    if (r > max) max = r;
    if (g > max) max = g;
    if (b > max) max = b;
  }
  const scale = Math.max(max, 1e-6);

  const out = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    for (let c = 0; c < 3; c++) {
      const value = (rgba[i * 4 + c] as number) / scale;
      out[c * pixels + i] = (value - (MEAN[c] as number)) / (STD[c] as number);
    }
  }
  return out;
}

/**
 * Rescale the model's raw output to 0…1 by its own extremes, as rembg does with `(pred - mi) /
 * (ma - mi)`.
 *
 * u2netp's d0 output is post-sigmoid and already inside 0…1, but its actual range on a given
 * image is often much narrower (0.02…0.6 is typical), and using it unstretched produces a
 * uniformly translucent subject. A flat output — every value identical, which happens when the
 * model finds nothing at all — would divide by zero, so it returns all-zeros: an empty mask,
 * which is the honest answer, rather than a canvas full of NaN that silently paints black.
 */
export function minMaxNormalise(values: Float32Array): Float32Array {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  const out = new Float32Array(values.length);
  if (!(range > 0)) return out;
  for (let i = 0; i < values.length; i++) out[i] = ((values[i] as number) - min) / range;
  return out;
}

/**
 * A 0…1 mask → greyscale RGBA, ready to be put on a canvas and scaled by the browser.
 *
 * Opaque on purpose: the browser's bilinear resampling would otherwise premultiply and blur the
 * mask's own alpha, which is not what is being scaled here. The mask value lives in the colour
 * channels; alpha is applied to the photograph later, by `composeAlpha`.
 */
export function maskToRgba(mask: Float32Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(mask.length * 4);
  for (let i = 0; i < mask.length; i++) {
    const v = Math.round(Math.min(1, Math.max(0, mask[i] as number)) * 255);
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Harden the mask at a cut-off, in place.
 *
 * `threshold` is 0…1, and 0 means "leave the model's soft mask alone" — worth keeping as an
 * option because on fur and motion blur the soft mask is the better answer. Above 0 the mask
 * becomes binary, which is what makes a background fully transparent instead of 4% grey; the
 * feather blur is applied AFTER this step, so the hard edge is softened rather than the
 * threshold eating a gradient it never saw.
 */
export function applyThresholdInPlace(maskRgba: Uint8ClampedArray, threshold: number): void {
  if (!(threshold > 0)) return;
  const cut = Math.min(1, threshold) * 255;
  for (let i = 0; i < maskRgba.length; i += 4) {
    const v = (maskRgba[i] as number) >= cut ? 255 : 0;
    maskRgba[i] = v;
    maskRgba[i + 1] = v;
    maskRgba[i + 2] = v;
  }
}

/**
 * Write the mask into the photograph's alpha channel, in place.
 *
 * Multiplied rather than assigned: a source PNG that already had transparent regions must not
 * gain opacity because the model was confident about that area.
 */
export function composeAlpha(pixels: Uint8ClampedArray, maskRgba: Uint8ClampedArray): void {
  if (pixels.length !== maskRgba.length) {
    throw new Error('composeAlpha: mask and image must have the same pixel count');
  }
  for (let i = 3; i < pixels.length; i += 4) {
    const existing = pixels[i] as number;
    const mask = maskRgba[i - 3] as number;
    pixels[i] = Math.round((existing * mask) / 255);
  }
}

/**
 * How much of the result survived, as fractions of all pixels.
 *
 * Shown to the user (a cutout that kept 3% or 99% of the image is a failed cutout, and they
 * should not have to squint at a checkerboard to find that out) and used as the quality gate's
 * measurement.
 */
export function alphaStats(pixels: Uint8ClampedArray): { opaque: number; transparent: number } {
  const total = pixels.length / 4;
  if (total === 0) return { opaque: 0, transparent: 0 };
  let opaque = 0;
  let transparent = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    const a = pixels[i] as number;
    if (a >= 250) opaque++;
    else if (a <= 10) transparent++;
  }
  return { opaque: opaque / total, transparent: transparent / total };
}
