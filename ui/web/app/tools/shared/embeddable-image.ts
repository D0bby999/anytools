/**
 * Turn a user-supplied image file into bytes pdf-lib can embed.
 *
 * Shared by image-to-pdf and watermark-pdf, which both need exactly this and would otherwise
 * each carry a copy of the two decisions below.
 *
 * 1. pdf-lib embeds PNG and JPEG only — `embedPng` and `embedJpg` are the entire API. WebP,
 *    AVIF, GIF and BMP have to be re-encoded first, and in a browser that means a canvas.
 * 2. Everything goes through the canvas, including images that are ALREADY PNG or JPEG. That
 *    is deliberate: `loadBitmap` decodes with `imageOrientation: 'from-image'`, so the EXIF
 *    rotation flag a phone camera writes is baked into the pixels. PDF has no equivalent flag,
 *    so embedding the original bytes of a portrait phone photo puts it in the document
 *    sideways — the single most common defect in this class of tool. Re-drawing is what fixes
 *    it, and a code path that only sometimes re-draws is a code path that is only sometimes
 *    correct.
 *
 * The cost is honest and documented on the tool pages: a JPEG is re-encoded once at quality
 * 0.92. PNG in, PNG out is lossless.
 */
import { drawToBlob, hasAlpha, loadBitmap } from './canvas-image';

/** The two formats pdf-lib can embed. */
export type EmbeddableFormat = 'png' | 'jpeg';

export type EmbeddableImage = {
  name: string;
  bytes: Uint8Array;
  format: EmbeddableFormat;
  /** Pixel dimensions AFTER EXIF orientation and any downscale — what the PDF will carry. */
  width: number;
  height: number;
};

/** Re-encode quality for photographic sources. Visually lossless at normal viewing sizes. */
const JPEG_QUALITY = 0.92;

/**
 * Give pdf-lib bytes that start at offset 0 of their own ArrayBuffer.
 *
 * `JpegEmbedder.for` does `new DataView(imageData.buffer)` and ignores `byteOffset`, so a
 * Uint8Array that is a *view* into a larger buffer is parsed from the wrong place. Node's
 * `Buffer.from` allocates out of a shared 8 KB pool — measured byteOffset 376 on the first
 * such call here — and `subarray` does the same, so a perfectly valid JPEG throws
 * "SOI not found in JPEG". Copying only when the view is offset keeps the common path free.
 */
export function ownBuffer(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes
    : bytes.slice();
}

/**
 * Decode, orient, optionally shrink, and encode.
 *
 * `limit` receives the decoded pixel size and returns the largest size worth keeping. It is a
 * callback rather than a plain `{maxWidth, maxHeight}` because callers size their budget from
 * the image's own aspect ratio (image-to-pdf works out how big the image will be printed
 * first, then asks for enough pixels to hit 150 dpi at that size) and decoding twice to learn
 * the aspect ratio would double the cost on exactly the large photos this exists to shrink.
 */
export async function toEmbeddableImage(
  file: File,
  limit?: (size: { width: number; height: number }) => { width: number; height: number },
): Promise<EmbeddableImage> {
  const bitmap = await loadBitmap(file);
  try {
    const capped = limit?.({ width: bitmap.width, height: bitmap.height });
    // Never enlarge: asking for more pixels than the source has invents detail and inflates
    // the PDF for nothing.
    const width = Math.max(1, Math.min(bitmap.width, Math.round(capped?.width ?? bitmap.width)));
    const height = Math.max(
      1,
      Math.min(bitmap.height, Math.round(capped?.height ?? bitmap.height)),
    );
    // PNG only where transparency is actually used. A photo re-encoded as PNG is routinely ten
    // times its JPEG size, and twenty of those make a PDF that will not open on a phone.
    const format: EmbeddableFormat = hasAlpha(bitmap) ? 'png' : 'jpeg';
    const blob = await drawToBlob(bitmap, width, height, format, JPEG_QUALITY);
    return {
      name: file.name,
      bytes: new Uint8Array(await blob.arrayBuffer()),
      format,
      width,
      height,
    };
  } finally {
    // Closing releases the decoded pixel buffer immediately rather than at the next GC. On a
    // batch of twenty 12 MP photos that is the difference between ~1 GB resident and ~50 MB.
    bitmap.close();
  }
}
