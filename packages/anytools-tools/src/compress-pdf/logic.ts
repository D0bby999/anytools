/**
 * Recompress a PDF's embedded images, in place: MozJPEG for opaque continuous-tone images,
 * oxipng (lossless) for anything with an alpha channel or a palette ("Indexed") colour space.
 *
 * Why this shape, not "extract images then rebuild the PDF": pdf.js (extract-images-from-pdf's
 * approach) hands back a SYNTHETIC per-page id for each image (`img_p${pageIndex}_${counter}`,
 * from pdf.js's own `idFactory.createObjId()`), not the PDF's real `/XObject` name or
 * reference — no way back to "which indirect object is this". Rebuilding each page from the
 * operator list instead would mean re-drawing everything, silently dropping any TEXT on a page
 * that mixes a photo with a caption.
 *
 * So this walks the file the other way: pdf-lib's own object graph, never pdf.js. Every
 * `/Subtype /Image` stream is decoded, resized, re-encoded, and written back to the SAME
 * indirect reference via `(Jpeg|Png)Embedder(...).embedIntoContext(ctx, ref)`. The page's
 * content stream — and any text, vector graphics or annotations on it — is never touched,
 * because nothing here rewrites it.
 *
 * Two source filters are handled, each decoded a different way but joined into one shared
 * resize/encode/embed tail below:
 *  - `/DCTDecode` (already a JPEG): decoded with the browser's own `createImageBitmap`.
 *  - `/FlateDecode` (raw pixel samples, deflate-compressed): decoded by pdf-flate-image-decode.ts
 *    — see that file's module comment for exactly which `/ColorSpace`/predictor/`/SMask` shapes
 *    are supported and why. Proven against two real, unrelated production PDFs before shipping:
 *    a government tax form (`ICCBased(N=3)` RGB + its own `DeviceGray` `/SMask`, no predictor)
 *    and a digitally-signed contract's signature-stamp image (`DeviceRGB` + `/SMask`, PNG
 *    predictor 15/"Optimum") — both decoded pixel-correct and are how this tool's own claims
 *    about FlateDecode support were verified, not guessed at.
 *
 * Deliberately NOT recompressed (left byte-for-byte, `imagesSkipped` counts them): anything
 * used as, or itself using, an `/SMask`/`/Mask` this tool cannot verify (see
 * pdf-flate-image-decode.ts for the FlateDecode-specific rules — DCTDecode images with any
 * `/SMask`/`/Mask` are always skipped, unchanged from before); any filter besides `/DCTDecode`
 * or `/FlateDecode` (`/CCITTFaxDecode`, `/JPXDecode`, `/JBIG2Decode`, `/LZWDecode`, multi-filter
 * chains); and anything the relevant decoder fails to decode.
 */
import { drawToImageData } from '../shared/canvas-image';
import { encodeJpegMozjpeg, encodeOptimizedPng } from '../shared/jsquash-loader';
import { ToolError } from '../shared/tool-error';
import { decodeImageForCompression, shouldKeepOriginal } from './pdf-compress-image-decode';
import type { FlateDecodeDeps } from './pdf-flate-image-decode';
import { collectMaskRefs, findHostPageSize } from './pdf-image-scan';

// Re-exported so callers (including logic.test.ts) keep a single import path for compress-pdf's
// pure helpers — the implementation lives in pdf-compress-image-decode.ts, split out to keep
// this file under this repo's ~200-line module budget.
export { isGrayColorSpaceName, shouldKeepOriginal } from './pdf-compress-image-decode';

const POINTS_PER_INCH = 72;

export class PdfCompressError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'PdfCompressError';
  }
}

export type CompressPdfOptions = {
  /** 1–100 — MozJPEG's own quality scale. Ignored for images encoded as PNG (lossless). */
  quality: number;
  /** Cap resolution assuming the image fills the page it is first found on. `null` = no cap. */
  maxDpi: number | null;
};

export type CompressPdfResult = {
  blob: Blob;
  pageCount: number;
  imagesRecompressed: number;
  imagesSkipped: number;
  sizeBefore: number;
  sizeAfter: number;
};

/**
 * Pixel size to downsample to so the image is at most `maxDpi` on a `pageWidthPt` ×
 * `pageHeightPt` page (PDF points, 72/inch) — assuming, as a scanned page does, that the image
 * fills the page. Never enlarges. Pure arithmetic, so it is unit-tested without pdf-lib.
 */
export function dpiCappedSize(
  pixelWidth: number,
  pixelHeight: number,
  pageWidthPt: number,
  pageHeightPt: number,
  maxDpi: number,
): { width: number; height: number } {
  const maxW = (pageWidthPt / POINTS_PER_INCH) * maxDpi;
  const maxH = (pageHeightPt / POINTS_PER_INCH) * maxDpi;
  const scale = Math.min(1, maxW / pixelWidth, maxH / pixelHeight);
  if (scale >= 1) return { width: pixelWidth, height: pixelHeight };
  return {
    width: Math.max(1, Math.round(pixelWidth * scale)),
    height: Math.max(1, Math.round(pixelHeight * scale)),
  };
}

export async function compressPdf(
  file: File,
  options: CompressPdfOptions,
): Promise<CompressPdfResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const {
    PDFDocument,
    PDFName,
    PDFDict,
    PDFRawStream,
    PDFRef,
    PDFArray,
    PDFNumber,
    PDFHexString,
    PDFString,
    JpegEmbedder,
    PngEmbedder,
    decodePDFRawStream,
  } = await import('pdf-lib');

  let pdfDoc: Awaited<ReturnType<typeof PDFDocument.load>>;
  try {
    pdfDoc = await PDFDocument.load(bytes);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/encrypt/i.test(msg)) {
      throw new PdfCompressError(
        'pdfPasswordProtected',
        `"${file.name}" is password-protected. Remove the password and try again.`,
        { name: file.name },
      );
    }
    throw new PdfCompressError('pdfUnreadable', `"${file.name}" could not be read as a PDF.`, {
      name: file.name,
    });
  }

  const pages = pdfDoc.getPages();
  const context = pdfDoc.context;
  const objects = context.enumerateIndirectObjects();

  const SUBTYPE = PDFName.of('Subtype');
  const IMAGE = PDFName.of('Image');
  const FILTER = PDFName.of('Filter');
  const DCT = PDFName.of('DCTDecode');
  const FLATE = PDFName.of('FlateDecode');
  const SMASK = PDFName.of('SMask');
  const MASK = PDFName.of('Mask');
  const COLOR_SPACE = PDFName.of('ColorSpace');
  const XOBJECT = PDFName.of('XObject');

  const maskRefs = collectMaskRefs(objects, PDFRawStream, PDFRef, SMASK, MASK);
  const flateDeps: FlateDecodeDeps = {
    PDFName,
    PDFArray,
    PDFRawStream,
    PDFHexString,
    PDFString,
    PDFNumber,
    PDFDict,
    decodePDFRawStream,
  };

  let imagesRecompressed = 0;
  let imagesSkipped = 0;

  for (const [ref, obj] of objects) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.get(SUBTYPE) !== IMAGE) continue;
    if (maskRefs.has(ref)) {
      imagesSkipped++; // consumed as another image's own /SMask or /Mask
      continue;
    }

    const filter = dict.get(FILTER);
    const decoded = await decodeImageForCompression(
      obj,
      dict,
      filter,
      { DCT, FLATE, SMASK, MASK, COLOR_SPACE },
      flateDeps,
    );
    if (!decoded) {
      imagesSkipped++;
      continue;
    }

    const pageSize = options.maxDpi ? findHostPageSize(pages, ref, XOBJECT, PDFDict) : null;
    const target =
      pageSize && options.maxDpi
        ? dpiCappedSize(
            decoded.bitmap.width,
            decoded.bitmap.height,
            pageSize.width,
            pageSize.height,
            options.maxDpi,
          )
        : { width: decoded.bitmap.width, height: decoded.bitmap.height };

    const imageData = drawToImageData(decoded.bitmap, target.width, target.height, {
      whiteBackground: !decoded.pngLossless,
    });
    decoded.bitmap.close();

    let encodedBytes: ArrayBuffer;
    try {
      encodedBytes = decoded.pngLossless
        ? await encodeOptimizedPng(imageData)
        : await encodeJpegMozjpeg(imageData, options.quality, decoded.grayscale);
    } catch {
      imagesSkipped++;
      continue;
    }

    if (shouldKeepOriginal(encodedBytes.byteLength, decoded.originalSize)) {
      imagesSkipped++;
      continue;
    }

    const embedder = decoded.pngLossless
      ? await PngEmbedder.for(new Uint8Array(encodedBytes))
      : await JpegEmbedder.for(new Uint8Array(encodedBytes));
    await embedder.embedIntoContext(context, ref);
    imagesRecompressed++;

    // Combining a /SMask (FlateDecode path) always registers a BRAND NEW alpha object at embed
    // time (see PngEmbedder in pdf-lib) — the OLD one is now unreachable from this image's dict,
    // but pdf-lib does not garbage-collect on save. Delete it ourselves, and only when we are
    // SURE nothing else in the document still points to it as a mask (count === 1): measured on
    // a real 262-image production PDF, skipping this step made the "compressed" file 7% BIGGER
    // than the input, from dozens of orphaned alpha streams left behind.
    if (
      decoded.consumedSmaskRef instanceof PDFRef &&
      maskRefs.get(decoded.consumedSmaskRef) === 1
    ) {
      context.delete(decoded.consumedSmaskRef);
    }
  }

  let outBytes: Uint8Array;
  try {
    outBytes = await pdfDoc.save();
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new PdfCompressError(
      'pdfSaveFailed',
      `Could not save the compressed PDF (${detail}). This is a bug on our side, not a problem with your file.`,
      { detail },
    );
  }

  // Copy into a fresh ArrayBuffer: pdf-lib returns a view over a pooled buffer (see merge-pdf).
  const blob = new Blob([outBytes.slice()], { type: 'application/pdf' });
  return {
    blob,
    pageCount: pages.length,
    imagesRecompressed,
    imagesSkipped,
    sizeBefore: file.size,
    sizeAfter: blob.size,
  };
}
