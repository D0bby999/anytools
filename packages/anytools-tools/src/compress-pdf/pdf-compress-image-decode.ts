/**
 * Per-image decode dispatch for compressPdf's main loop — split out to keep logic.ts under this
 * repo's ~200-line module budget. Two source filters, two decoders, one shared result shape
 * consumed by logic.ts's resize/encode/embed tail:
 *  - `/DCTDecode` (already a JPEG): decoded with the browser's own `createImageBitmap`. Any
 *    `/SMask`/`/Mask` on a DCTDecode image is still always skipped — unchanged from before this
 *    file existed, and not something this change re-verified.
 *  - `/FlateDecode`: decoded by pdf-flate-image-decode.ts — see that file's module comment for
 *    the exact `/ColorSpace`/predictor/`/SMask` shapes proven, and logic.ts's module comment
 *    for the two real PDFs used to prove them.
 */
import { type FlateDecodeDeps, decodeFlateImage } from './pdf-flate-image-decode';

type RawStream = ReturnType<FlateDecodeDeps['PDFRawStream']['of']>;
type DictObj = RawStream['dict'];
type NameObj = ReturnType<FlateDecodeDeps['PDFName']['of']>;

/** Is this PDF `/ColorSpace` name one this tool preserves as grayscale rather than upgrading
 *  to a 3-component JPEG (which would triple the size of a black-and-white scan for nothing)? */
export function isGrayColorSpaceName(name: string | undefined): boolean {
  return name === '/DeviceGray' || name === '/CalGray';
}

/** Never trade a smaller resolution claim for a bigger file — only keep a recompressed image if
 *  it actually helped. `originalSize` is whatever the caller decided the honest "before" total
 *  is (base image alone, or base + `/SMask` when the two were combined into one PNG). */
export function shouldKeepOriginal(encodedSize: number, originalSize: number): boolean {
  return encodedSize >= originalSize;
}

/** Decoded pixels ready for logic.ts's shared resize/encode/embed tail, regardless of which
 *  filter produced them. `originalSize` is the byte total to compare the recompressed result
 *  against — base image plus its `/SMask` when one was folded in, so "keep the original if
 *  recompression didn't help" is an honest whole-PDF comparison, not just the base stream.
 *  `consumedSmaskRef` is that `/SMask`'s OWN indirect reference (unresolved) when one was folded
 *  in — re-embedding always registers a BRAND NEW alpha object (see `PngEmbedder` in pdf-lib),
 *  so without deleting the old one every combined image would leave its original alpha stream
 *  as dead weight in the saved file. Measured on a real 262-image production PDF: leaving those
 *  orphans in made the "compressed" output 7% LARGER than the input — undefined here (no
 *  `/SMask` was folded in) means there is nothing to delete. */
export type DecodedImageForCompression = {
  bitmap: ImageBitmap;
  grayscale: boolean;
  pngLossless: boolean;
  originalSize: number;
  consumedSmaskRef?: unknown;
};

export type ImageFilterNames = {
  DCT: NameObj;
  FLATE: NameObj;
  SMASK: NameObj;
  MASK: NameObj;
  COLOR_SPACE: NameObj;
};

/** Returns null for anything not decodable (caller counts it as `imagesSkipped`) — never throws
 *  for an unsupported shape, only for a genuine decoder failure the caller also treats as skip. */
export async function decodeImageForCompression(
  obj: RawStream,
  dict: DictObj,
  filter: unknown,
  names: ImageFilterNames,
  deps: FlateDecodeDeps,
): Promise<DecodedImageForCompression | null> {
  if (filter === names.DCT) {
    if (dict.has(names.SMASK) || dict.has(names.MASK)) return null;
    try {
      const bitmap = await createImageBitmap(new Blob([obj.getContents()], { type: 'image/jpeg' }));
      return {
        bitmap,
        grayscale: isGrayColorSpaceName(dict.get(names.COLOR_SPACE)?.toString()),
        pngLossless: false,
        originalSize: obj.getContentsSize(),
      };
    } catch {
      return null;
    }
  }

  if (filter === names.FLATE) {
    const flat = decodeFlateImage(obj, deps);
    if (!flat) return null;

    let originalSize = obj.getContentsSize();
    let consumedSmaskRef: unknown;
    if (flat.hasAlpha) {
      const smaskObj = dict.lookup(names.SMASK);
      if (smaskObj instanceof deps.PDFRawStream) originalSize += smaskObj.getContentsSize();
      consumedSmaskRef = dict.get(names.SMASK); // the raw (unresolved) ref, for the caller to delete
    }

    try {
      const bitmap = await createImageBitmap(new ImageData(flat.rgba, flat.width, flat.height));
      return {
        bitmap,
        grayscale: flat.kind === 'gray',
        pngLossless: flat.hasAlpha || flat.kind === 'indexed',
        originalSize,
        consumedSmaskRef,
      };
    } catch {
      return null;
    }
  }

  return null; // /CCITTFaxDecode, /JPXDecode, /JBIG2Decode, /LZWDecode, filter chains, ...
}
