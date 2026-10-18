/**
 * Colour-space resolution for compress-pdf's `/FlateDecode` image support, split out from
 * pdf-flate-image-decode.ts to keep files within this repo's ~200-line module budget.
 *
 * Deliberately narrow: every kind returned here was proven correct against either a real PDF
 * (DeviceGray/DeviceRGB/ICCBased — see logic.ts's module comment for the two production files
 * used) or a hand-built ground-truth fixture (DeviceCMYK, Indexed — no sample of either turned
 * up across ~35 real PDFs surveyed while building this, so those are proven numerically instead
 * of visually; see logic.test.ts). Anything this cannot classify returns null, and the caller
 * skips the image rather than guess at colour data — this repo's `imagesSkipped` counter, not a
 * silently wrong image.
 *
 * `PdfClasses` mirrors pdf-image-scan.ts's dependency-injection shape: the live pdf-lib class
 * VALUES are passed in by the caller (which already imported `pdf-lib` dynamically), so this
 * file only imports pdf-lib's TYPES — erased at compile time, no duplicate runtime bundle.
 */
type PdfLib = typeof import('pdf-lib');

export type PdfClasses = {
  PDFName: PdfLib['PDFName'];
  PDFArray: PdfLib['PDFArray'];
  PDFRawStream: PdfLib['PDFRawStream'];
  PDFHexString: PdfLib['PDFHexString'];
  PDFString: PdfLib['PDFString'];
  PDFNumber: PdfLib['PDFNumber'];
};

export type ColorSpaceInfo =
  | { kind: 'gray'; components: 1 }
  | { kind: 'rgb'; components: 3 }
  | { kind: 'cmyk'; components: 4 }
  | {
      kind: 'indexed';
      components: 1;
      base: 'gray' | 'rgb';
      baseComponents: 1 | 3;
      hival: number;
      palette: Uint8Array;
    };

function deviceOrCalKind(nameStr: string): 'gray' | 'rgb' | 'cmyk' | null {
  if (nameStr === '/DeviceGray' || nameStr === '/CalGray') return 'gray';
  if (nameStr === '/DeviceRGB' || nameStr === '/CalRGB') return 'rgb';
  if (nameStr === '/DeviceCMYK') return 'cmyk';
  return null;
}

/** ICCBased streams carry no colour-managed engine here — `/N` (component count) is used the
 *  same way every viewer without one falls back: 1↦Gray, 3↦RGB, 4↦CMYK (PDF 32000-1 §8.6.5.5). */
function iccKind(n: number): 'gray' | 'rgb' | 'cmyk' | null {
  if (n === 1) return 'gray';
  if (n === 3) return 'rgb';
  if (n === 4) return 'cmyk';
  return null;
}

function baseInfo(
  kind: 'gray' | 'rgb' | 'cmyk' | null,
): { base: 'gray' | 'rgb'; baseComponents: 1 | 3 } | null {
  if (kind === 'gray') return { base: 'gray', baseComponents: 1 };
  if (kind === 'rgb') return { base: 'rgb', baseComponents: 3 };
  return null; // CMYK base is unproven — Indexed over CMYK is rejected, not guessed at.
}

/** A lookup table is either a literal/hex string, or a stream (itself possibly FlateDecode). */
function resolveLookupBytes(
  entry: unknown,
  classes: PdfClasses,
  decodeRawStream: (s: ReturnType<PdfClasses['PDFRawStream']['of']>) => Uint8Array,
): Uint8Array | null {
  const { PDFHexString, PDFString, PDFRawStream, PDFName } = classes;
  if (entry instanceof PDFHexString || entry instanceof PDFString) return entry.asBytes();
  if (entry instanceof PDFRawStream) {
    const filter = entry.dict.get(PDFName.of('Filter'));
    if (filter !== undefined && filter.toString() !== '/FlateDecode') return null;
    try {
      return decodeRawStream(entry);
    } catch {
      return null;
    }
  }
  return null;
}

function resolveBase(
  baseValue: unknown,
  classes: PdfClasses,
): { base: 'gray' | 'rgb'; baseComponents: 1 | 3 } | null {
  const { PDFName, PDFArray, PDFRawStream, PDFNumber } = classes;
  if (baseValue instanceof PDFName) return baseInfo(deviceOrCalKind(baseValue.toString()));
  if (!(baseValue instanceof PDFArray) || baseValue.size() === 0) return null;
  const head = baseValue.lookup(0);
  const headName = head instanceof PDFName ? head.toString() : null;
  if (headName === '/CalGray') return { base: 'gray', baseComponents: 1 };
  if (headName === '/CalRGB') return { base: 'rgb', baseComponents: 3 };
  if (headName === '/ICCBased') {
    const stream = baseValue.lookup(1);
    if (!(stream instanceof PDFRawStream)) return null;
    const n = stream.dict.lookup(PDFName.of('N'));
    return baseInfo(n instanceof PDFNumber ? iccKind(n.asNumber()) : null);
  }
  return null;
}

/**
 * `csValue` is whatever `dict.lookup(PDFName.of('ColorSpace'))` returned — already ref-resolved
 * one level (pdf-lib's own `.lookup()` follows indirect references). `decodeRawStream` is
 * injected so this file never imports `decodePDFRawStream` itself; the caller already needs it
 * for the image's own pixel data.
 */
export function resolveColorSpace(
  csValue: unknown,
  classes: PdfClasses,
  decodeRawStream: (s: ReturnType<PdfClasses['PDFRawStream']['of']>) => Uint8Array,
): ColorSpaceInfo | null {
  const { PDFName, PDFArray, PDFRawStream, PDFNumber } = classes;

  if (csValue instanceof PDFName) {
    const kind = deviceOrCalKind(csValue.toString());
    if (kind === 'gray') return { kind, components: 1 };
    if (kind === 'rgb') return { kind, components: 3 };
    if (kind === 'cmyk') return { kind, components: 4 };
    return null;
  }
  if (!(csValue instanceof PDFArray) || csValue.size() === 0) return null;

  const head = csValue.lookup(0);
  const headName = head instanceof PDFName ? head.toString() : null;

  if (headName === '/CalGray') return { kind: 'gray', components: 1 };
  if (headName === '/CalRGB') return { kind: 'rgb', components: 3 };

  if (headName === '/ICCBased') {
    const stream = csValue.lookup(1);
    if (!(stream instanceof PDFRawStream)) return null;
    const n = stream.dict.lookup(PDFName.of('N'));
    const kind = n instanceof PDFNumber ? iccKind(n.asNumber()) : null;
    if (kind === 'gray') return { kind, components: 1 };
    if (kind === 'rgb') return { kind, components: 3 };
    if (kind === 'cmyk') return { kind, components: 4 };
    return null;
  }

  if (headName === '/Indexed') {
    if (csValue.size() < 4) return null;
    const hivalObj = csValue.lookup(2);
    const hival = hivalObj instanceof PDFNumber ? hivalObj.asNumber() : null;
    if (hival === null || hival < 0 || hival > 255) return null;

    const resolvedBase = resolveBase(csValue.lookup(1), classes);
    if (!resolvedBase) return null;

    const paletteBytes = resolveLookupBytes(csValue.lookup(3), classes, decodeRawStream);
    if (!paletteBytes || paletteBytes.length < (hival + 1) * resolvedBase.baseComponents)
      return null;

    return { kind: 'indexed', components: 1, ...resolvedBase, hival, palette: paletteBytes };
  }

  return null;
}
