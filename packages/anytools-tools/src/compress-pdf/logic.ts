/**
 * Recompress a PDF's embedded JPEG images with MozJPEG, in place.
 *
 * Why this shape, not "extract images then rebuild the PDF": pdf.js (extract-images-from-pdf's
 * approach) hands back a SYNTHETIC per-page id for each image (`img_p${pageIndex}_${counter}`,
 * from pdf.js's own `idFactory.createObjId()`), not the PDF's real `/XObject` name or
 * reference — no way back to "which indirect object is this". Rebuilding each page from the
 * operator list instead would mean re-drawing everything, silently dropping any TEXT on a page
 * that mixes a photo with a caption.
 *
 * So this walks the file the other way: pdf-lib's own object graph, never pdf.js. Every
 * `/Subtype /Image` stream whose `/Filter` is `/DCTDecode` (it already IS a JPEG) is decoded,
 * resized, re-encoded with MozJPEG, and written back to the SAME indirect reference via
 * `JpegEmbedder(...).embedIntoContext(ctx, ref)`. The page's content stream — and any text,
 * vector graphics or annotations on it — is never touched, because nothing here rewrites it.
 *
 * Deliberately NOT recompressed (left byte-for-byte, `imagesSkipped` counts them): anything
 * used as, or itself using, an `/SMask`/`/Mask` (recompressing a colour channel independently
 * of its alpha mask risks a corrupted composite this tool cannot verify); anything not
 * `/DCTDecode` (`/FlateDecode`, `/CCITTFaxDecode`, `/JPXDecode`, `/JBIG2Decode` all need their
 * `/ColorSpace`/`/BitsPerComponent` interpreted by hand — scanners overwhelmingly emit
 * `/DCTDecode`, so this covers the case that matters without guessing at colour data this tool
 * cannot verify); and anything `createImageBitmap` fails to decode (e.g. a CMYK JPEG many
 * browsers reject).
 */
import { drawToImageData } from '../shared/canvas-image';
import { encodeJpegMozjpeg } from '../shared/jsquash-loader';
import { ToolError } from '../shared/tool-error';
import { collectMaskRefs, findHostPageSize } from './pdf-image-scan';

const POINTS_PER_INCH = 72;

export class PdfCompressError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'PdfCompressError';
  }
}

export type CompressPdfOptions = {
  /** 1–100 — MozJPEG's own quality scale. */
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

/** Is this PDF `/ColorSpace` name one this tool preserves as grayscale rather than upgrading
 *  to a 3-component JPEG (which would triple the size of a black-and-white scan for nothing)? */
export function isGrayColorSpaceName(name: string | undefined): boolean {
  return name === '/DeviceGray' || name === '/CalGray';
}

export async function compressPdf(
  file: File,
  options: CompressPdfOptions,
): Promise<CompressPdfResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { PDFDocument, PDFName, PDFDict, PDFRawStream, PDFRef, JpegEmbedder } = await import(
    'pdf-lib'
  );

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
  const SMASK = PDFName.of('SMask');
  const MASK = PDFName.of('Mask');
  const COLOR_SPACE = PDFName.of('ColorSpace');
  const XOBJECT = PDFName.of('XObject');

  const maskRefs = collectMaskRefs(objects, PDFRawStream, PDFRef, SMASK, MASK);

  let imagesRecompressed = 0;
  let imagesSkipped = 0;

  for (const [ref, obj] of objects) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if (dict.get(SUBTYPE) !== IMAGE) continue;
    if (maskRefs.has(ref) || dict.has(SMASK) || dict.has(MASK) || dict.get(FILTER) !== DCT) {
      imagesSkipped++;
      continue;
    }

    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(new Blob([obj.getContents()], { type: 'image/jpeg' }));
    } catch {
      imagesSkipped++;
      continue;
    }

    const pageSize = options.maxDpi ? findHostPageSize(pages, ref, XOBJECT, PDFDict) : null;
    const target =
      pageSize && options.maxDpi
        ? dpiCappedSize(
            bitmap.width,
            bitmap.height,
            pageSize.width,
            pageSize.height,
            options.maxDpi,
          )
        : { width: bitmap.width, height: bitmap.height };

    const grayscale = isGrayColorSpaceName(dict.get(COLOR_SPACE)?.toString());
    const imageData = drawToImageData(bitmap, target.width, target.height);
    bitmap.close();

    let jpegBytes: ArrayBuffer;
    try {
      jpegBytes = await encodeJpegMozjpeg(imageData, options.quality, grayscale);
    } catch {
      imagesSkipped++;
      continue;
    }

    // Never trade a smaller resolution claim for a bigger file — only keep it if it helped.
    if (jpegBytes.byteLength >= obj.getContentsSize()) {
      imagesSkipped++;
      continue;
    }

    const embedder = await JpegEmbedder.for(new Uint8Array(jpegBytes));
    await embedder.embedIntoContext(context, ref);
    imagesRecompressed++;
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
