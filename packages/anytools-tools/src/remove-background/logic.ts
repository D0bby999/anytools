/**
 * Run u2netp over an image and turn its saliency map into an alpha channel.
 *
 * The pipeline follows rembg's, because that is what this model file was published for:
 * stretch to 320×320 → normalise → run → take d0 → min-max stretch → scale the mask back up →
 * use as alpha. The arithmetic is in ./mask-math.ts (unit-tested), the canvas work in
 * ./mask-canvas.ts; this file is the order of operations and the session call. Everything that
 * touches a canvas or the WASM session is verified in the browser lane, not in vitest — happy-dom
 * returns null from getContext and never calls back from toBlob.
 */
import { ImageToolError, loadBitmap } from '../shared/canvas-image';
import { type ModelProgress, loadOnnxRuntime, loadOnnxSession } from '../shared/onnx-loader';
import { buildMask, surface, toPng } from './mask-canvas';
import {
  MODEL_SIZE,
  alphaStats,
  composeAlpha,
  minMaxNormalise,
  normaliseToTensor,
} from './mask-math';

/** Staged by copy-vendor-assets.mjs (manifest key `u2netp`), sha256-pinned. Our origin only. */
export const MODEL_URL = '/third-party/u2netp/u2netp.onnx';

export type RemoveBackgroundOptions = {
  /** 0…1 cut-off applied to the mask. 0 keeps the model's soft mask unchanged. */
  threshold: number;
  /** Blur radius in pixels applied to the mask edge after thresholding. 0 = off. */
  feather: number;
  /** CSS colour to flatten the cutout onto, or null for a transparent PNG. */
  background: string | null;
};

/**
 * `engine` and `model` are the two one-off downloads (14 MB runtime, 4.4 MB weights), in that
 * order; `inference` is the run itself, which is one opaque call into WASM and reports no bytes.
 */
export type RemoveBackgroundProgress = {
  stage: ModelProgress['file'] | 'inference';
  loaded: number;
  total: number;
};

export type RemoveBackgroundResult = {
  blob: Blob;
  width: number;
  height: number;
  /** Share of pixels left fully opaque (the subject) and fully transparent (the background). */
  opaque: number;
  transparent: number;
  inferenceMs: number;
};

/**
 * Decode the image into the model's input tensor.
 *
 * The image is STRETCHED to a square, not letterboxed. That looks wrong and is right: U-2-Net's
 * training transform (`RescaleT(320)`) and rembg both resize to 320×320 without preserving the
 * aspect ratio, so a letterboxed input — however tidy — is a distribution the weights never saw,
 * and it also wastes resolution on padding.
 */
function toModelInput(bitmap: ImageBitmap): Float32Array {
  const { ctx } = surface(MODEL_SIZE, MODEL_SIZE);
  ctx.drawImage(bitmap, 0, 0, MODEL_SIZE, MODEL_SIZE);
  return normaliseToTensor(ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data);
}

/**
 * Feed the tensor through the session and return d0 as a 0…1 mask.
 *
 * Input and output names are read from the session rather than hard-coded: this model calls them
 * `input.1` and `1959`…`1965` (the seven side outputs of the U-structure, d0 first), which are
 * PyTorch export artefacts that a re-export would renumber. d0 is `outputNames[0]`, shaped
 * 1×1×320×320; `subarray` takes channel 0 the way rembg's `ort_outs[0][:, 0, :, :]` does.
 */
async function runModel(
  ort: Awaited<ReturnType<typeof loadOnnxRuntime>>,
  session: Awaited<ReturnType<typeof loadOnnxSession>>,
  input: Float32Array,
): Promise<Float32Array> {
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) {
    throw new ImageToolError('The background model exposes no inputs — the file may be corrupt.');
  }
  const pixels = MODEL_SIZE * MODEL_SIZE;
  const feeds = {
    [inputName]: new ort.Tensor('float32', input, [1, 3, MODEL_SIZE, MODEL_SIZE]),
  };
  const results = await session.run(feeds);
  const data = results[outputName]?.data;
  if (!(data instanceof Float32Array) || data.length < pixels) {
    throw new ImageToolError('The background model returned an unexpected result.');
  }
  return minMaxNormalise(data.subarray(0, pixels));
}

/**
 * Remove the background from one image.
 *
 * `onProgress` reports the two one-off downloads (engine, then model) byte by byte. Inference is
 * a single opaque call into WASM with no intermediate signal, so it is announced as a stage and
 * not as a percentage the code would have to invent.
 */
export async function removeBackground(
  file: File,
  options: RemoveBackgroundOptions,
  onProgress?: (p: RemoveBackgroundProgress) => void,
): Promise<RemoveBackgroundResult> {
  const bitmap = await loadBitmap(file);
  try {
    const input = toModelInput(bitmap);
    onProgress?.({ stage: 'engine', loaded: 0, total: 0 });
    const session = await loadOnnxSession(MODEL_URL, (p) =>
      onProgress?.({ stage: p.file, loaded: p.loaded, total: p.total }),
    );
    const ort = await loadOnnxRuntime();

    onProgress?.({ stage: 'inference', loaded: 0, total: 0 });
    const started = performance.now();
    const mask = await runModel(ort, session, input);
    const inferenceMs = Math.round(performance.now() - started);

    const { width, height } = bitmap;
    const maskData = buildMask(mask, width, height, options);

    const cutout = surface(width, height);
    cutout.ctx.drawImage(bitmap, 0, 0);
    const pixels = cutout.ctx.getImageData(0, 0, width, height);
    composeAlpha(pixels.data, maskData.data);
    // Measured on the cutout, before any background is flattened on: the useful number is how
    // much the MASK kept, and after flattening every pixel is opaque by definition.
    const stats = alphaStats(pixels.data);
    cutout.ctx.putImageData(pixels, 0, 0);

    let output = cutout;
    if (options.background) {
      output = surface(width, height);
      output.ctx.fillStyle = options.background;
      output.ctx.fillRect(0, 0, width, height);
      output.ctx.drawImage(cutout.canvas, 0, 0);
    }

    return {
      blob: await toPng(output.canvas),
      width,
      height,
      opaque: stats.opaque,
      transparent: stats.transparent,
      inferenceMs,
    };
  } finally {
    // Decoded pixels live outside the JS heap; a few large photos without this exhaust the tab.
    bitmap.close();
  }
}
