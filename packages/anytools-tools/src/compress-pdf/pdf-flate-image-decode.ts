/**
 * Decode ONE `/FlateDecode` image XObject (base pixels + optional `/SMask` alpha) into RGBA,
 * or return null when anything about it falls outside what this tool has proven correct.
 * Ties together pdf-flate-colorspace.ts (what the pixels MEAN) and pdf-flate-pixel-decode.ts
 * (pure predictor/unpack/RGBA math) with pdf-lib's real object graph.
 *
 * What causes a skip (never a guess) — see logic.ts's module comment for the two real PDFs this
 * was proven against:
 *  - `/Filter` is anything but the single Name `/FlateDecode` (an array/chain like
 *    `[/ASCII85Decode /FlateDecode]` is not unwrapped — no sample of that combination was
 *    verified).
 *  - `/BitsPerComponent` outside {1,2,4,8,16}, or a `/ColorSpace` pdf-flate-colorspace.ts
 *    cannot classify (Separation, DeviceN, Lab, an unresolvable named resource, ...).
 *  - A non-default `/Decode` array on the image OR its `/SMask` — only the identity Decode
 *    every encoder implies by omission is handled.
 *  - A `/Predictor` that is neither "none" nor PNG-style (10–15) — TIFF predictor (2) included.
 *  - `/Mask` (stencil or colour-key) in any form — unproven, always skipped.
 *  - An `/SMask` that is not itself FlateDecode+DeviceGray at the SAME pixel dimensions as the
 *    base image (no resampling is attempted) — dropping transparency silently would be exactly
 *    the "corrupted image" this tool exists to avoid, so the WHOLE image is skipped, not just
 *    its alpha. A JPEG-encoded `/SMask` (real example: an Adobe-style CMYK PDF found while
 *    building this) is one deliberately-unhandled instance of that rule.
 *  - Images with no explicit `/ColorSpace` (stencil masks flagged `/ImageMask true`) fall out
 *    naturally here: pdf-flate-colorspace.ts cannot classify `undefined`, so no separate
 *    `/ImageMask` check is needed.
 */
import type { ColorSpaceInfo, PdfClasses } from './pdf-flate-colorspace';
import { resolveColorSpace } from './pdf-flate-colorspace';
import {
  type SampleKind,
  samplesToRgba,
  undoPredictor,
  unpackSamples,
} from './pdf-flate-pixel-decode';

type PdfLib = typeof import('pdf-lib');

export type FlateDecodeDeps = PdfClasses & {
  PDFDict: PdfLib['PDFDict'];
  decodePDFRawStream: PdfLib['decodePDFRawStream'];
};

type RawStream = ReturnType<PdfClasses['PDFRawStream']['of']>;

export type FlateImageDecodeResult = {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  hasAlpha: boolean;
  kind: SampleKind;
};

const SUPPORTED_BPC = new Set([1, 2, 4, 8, 16]);

type DecodedSamples = {
  samples: Uint16Array;
  width: number;
  height: number;
  bitsPerComponent: number;
  cs: ColorSpaceInfo;
};

/** Shared by the base image and its `/SMask` — both are just "a FlateDecode image stream". */
function decodeImageSamples(obj: RawStream, deps: FlateDecodeDeps): DecodedSamples | null {
  const { PDFName, PDFDict, PDFNumber, decodePDFRawStream } = deps;
  const dict = obj.dict;

  if (dict.get(PDFName.of('Filter'))?.toString() !== '/FlateDecode') return null;
  if (dict.has(PDFName.of('Decode'))) return null;

  const widthObj = dict.lookup(PDFName.of('Width'));
  const heightObj = dict.lookup(PDFName.of('Height'));
  if (!(widthObj instanceof PDFNumber) || !(heightObj instanceof PDFNumber)) return null;
  const width = widthObj.asNumber();
  const height = heightObj.asNumber();
  if (!(width > 0) || !(height > 0)) return null;

  const bpcObj = dict.lookup(PDFName.of('BitsPerComponent'));
  const bitsPerComponent = bpcObj instanceof PDFNumber ? bpcObj.asNumber() : 8;
  if (!SUPPORTED_BPC.has(bitsPerComponent)) return null;

  const csValue = dict.lookup(PDFName.of('ColorSpace'));
  const cs = resolveColorSpace(csValue, deps, (s) => decodePDFRawStream(s).decode());
  if (!cs) return null;

  const parms = dict.lookup(PDFName.of('DecodeParms'));
  const predictor =
    parms instanceof PDFDict
      ? ((v) => (v instanceof PDFNumber ? v.asNumber() : 1))(parms.lookup(PDFName.of('Predictor')))
      : 1;

  let inflated: Uint8Array;
  try {
    inflated = decodePDFRawStream(obj).decode();
  } catch {
    return null;
  }

  const rowBytes = Math.ceil((cs.components * bitsPerComponent * width) / 8);
  const bytesPerPixel = Math.max(1, Math.ceil((cs.components * bitsPerComponent) / 8));
  const unfiltered = undoPredictor(inflated, predictor, rowBytes, bytesPerPixel);
  if (!unfiltered || unfiltered.length < rowBytes * height) return null;

  const samples = unpackSamples(unfiltered, width, height, cs.components, bitsPerComponent);
  return { samples, width, height, bitsPerComponent, cs };
}

export function decodeFlateImage(
  obj: RawStream,
  deps: FlateDecodeDeps,
): FlateImageDecodeResult | null {
  const { PDFName, PDFRawStream } = deps;
  const dict = obj.dict;

  if (dict.has(PDFName.of('Mask'))) return null;

  const base = decodeImageSamples(obj, deps);
  if (!base) return null;

  const palette = base.cs.kind === 'indexed' ? base.cs.palette : undefined;
  const rgba = samplesToRgba(
    base.samples,
    base.width,
    base.height,
    base.cs.components,
    base.bitsPerComponent,
    base.cs.kind,
    palette,
  );

  let hasAlpha = false;
  const smaskValue = dict.lookup(PDFName.of('SMask'));
  if (smaskValue !== undefined) {
    if (!(smaskValue instanceof PDFRawStream)) return null;
    const alpha = decodeImageSamples(smaskValue, deps);
    if (
      !alpha ||
      alpha.cs.kind !== 'gray' ||
      alpha.width !== base.width ||
      alpha.height !== base.height
    ) {
      // Cannot safely combine — dropping transparency silently would be a corrupted image, so
      // the whole image is skipped rather than shown falsely opaque.
      return null;
    }
    const alphaRgba = samplesToRgba(
      alpha.samples,
      alpha.width,
      alpha.height,
      1,
      alpha.bitsPerComponent,
      'gray',
    );
    for (let p = 0; p < base.width * base.height; p++) {
      rgba[p * 4 + 3] = alphaRgba[p * 4] ?? 255;
    }
    hasAlpha = true;
  }

  return { rgba, width: base.width, height: base.height, hasAlpha, kind: base.cs.kind };
}
