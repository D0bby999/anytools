// resolveColorSpace against REAL pdf-lib objects (PDFContext/PDFDict/PDFArray/PDFRawStream) —
// no browser APIs needed, so unlike the encode/embed tail this runs directly under Vitest.
// Two of the "real PDF" shapes here (DeviceGray/DeviceRGB, ICCBased N=3) were also verified
// against actual production PDFs while building this — see logic.ts's module comment.
import { deflateSync, inflateSync } from 'node:zlib';
import {
  PDFArray,
  PDFContext,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { type PdfClasses, resolveColorSpace } from './pdf-flate-colorspace';

const classes: PdfClasses = { PDFName, PDFArray, PDFRawStream, PDFHexString, PDFString, PDFNumber };

/** Every test here only ever hands `resolveColorSpace` a FlateDecode-or-nothing lookup stream,
 *  so a plain inflate stands in for the real `decodePDFRawStream` the production code injects. */
function decodeRawStream(s: ReturnType<typeof PDFRawStream.of>): Uint8Array {
  return new Uint8Array(inflateSync(s.getContents()));
}

function iccStream(ctx: PDFContext, n: number): ReturnType<typeof PDFRawStream.of> {
  const dict = PDFDict.withContext(ctx);
  dict.set(PDFName.of('N'), PDFNumber.of(n));
  return PDFRawStream.of(dict, new Uint8Array());
}

describe('resolveColorSpace', () => {
  it('resolves /DeviceGray and /CalGray to gray, 1 component', () => {
    expect(resolveColorSpace(PDFName.of('DeviceGray'), classes, decodeRawStream)).toEqual({
      kind: 'gray',
      components: 1,
    });
    expect(resolveColorSpace(PDFName.of('CalGray'), classes, decodeRawStream)).toEqual({
      kind: 'gray',
      components: 1,
    });
  });

  it('resolves /DeviceRGB and /CalRGB to rgb, 3 components', () => {
    expect(resolveColorSpace(PDFName.of('DeviceRGB'), classes, decodeRawStream)).toEqual({
      kind: 'rgb',
      components: 3,
    });
    expect(resolveColorSpace(PDFName.of('CalRGB'), classes, decodeRawStream)).toEqual({
      kind: 'rgb',
      components: 3,
    });
  });

  it('resolves /DeviceCMYK to cmyk, 4 components', () => {
    expect(resolveColorSpace(PDFName.of('DeviceCMYK'), classes, decodeRawStream)).toEqual({
      kind: 'cmyk',
      components: 4,
    });
  });

  it('resolves an unknown Name to null', () => {
    expect(resolveColorSpace(PDFName.of('Separation'), classes, decodeRawStream)).toBeNull();
  });

  it('resolves undefined (no /ColorSpace key — e.g. an /ImageMask stencil) to null', () => {
    expect(resolveColorSpace(undefined, classes, decodeRawStream)).toBeNull();
  });

  it('resolves [/ICCBased stream] by /N: 1->gray, 3->rgb, 4->cmyk', () => {
    const ctx = PDFContext.create();
    for (const [n, kind, components] of [
      [1, 'gray', 1],
      [3, 'rgb', 3],
      [4, 'cmyk', 4],
    ] as const) {
      const arr = PDFArray.withContext(ctx);
      arr.push(PDFName.of('ICCBased'));
      arr.push(iccStream(ctx, n));
      expect(resolveColorSpace(arr, classes, decodeRawStream)).toEqual({ kind, components });
    }
  });

  it('resolves ICCBased with an unsupported /N (e.g. 2) to null', () => {
    const ctx = PDFContext.create();
    const arr = PDFArray.withContext(ctx);
    arr.push(PDFName.of('ICCBased'));
    arr.push(iccStream(ctx, 2));
    expect(resolveColorSpace(arr, classes, decodeRawStream)).toBeNull();
  });

  it('resolves Indexed with a DeviceRGB base and a hex-string lookup table', () => {
    const ctx = PDFContext.create();
    const arr = PDFArray.withContext(ctx);
    arr.push(PDFName.of('Indexed'));
    arr.push(PDFName.of('DeviceRGB'));
    arr.push(PDFNumber.of(1));
    arr.push(PDFHexString.of('0a141ec8d2dc'));
    const info = resolveColorSpace(arr, classes, decodeRawStream);
    expect(info?.kind).toBe('indexed');
    if (info?.kind === 'indexed') {
      expect(info.base).toBe('rgb');
      expect(info.hival).toBe(1);
      expect(Array.from(info.palette)).toEqual([0x0a, 0x14, 0x1e, 0xc8, 0xd2, 0xdc]);
    }
  });

  it('resolves Indexed with a DeviceGray base and a PDFString (literal-string) lookup table', () => {
    const ctx = PDFContext.create();
    const arr = PDFArray.withContext(ctx);
    arr.push(PDFName.of('Indexed'));
    arr.push(PDFName.of('DeviceGray'));
    arr.push(PDFNumber.of(1));
    const literalTwoBytes = String.fromCharCode(1, 2); // 2 literal bytes: 0x01, 0x02
    arr.push(PDFString.of(literalTwoBytes));
    const info = resolveColorSpace(arr, classes, decodeRawStream);
    expect(info?.kind).toBe('indexed');
    if (info?.kind === 'indexed') {
      expect(info.base).toBe('gray');
      expect(info.baseComponents).toBe(1);
      expect(Array.from(info.palette)).toEqual([1, 2]);
    }
  });

  it('rejects Indexed over an unresolvable/CMYK base', () => {
    const ctx = PDFContext.create();
    const arr = PDFArray.withContext(ctx);
    arr.push(PDFName.of('Indexed'));
    arr.push(PDFName.of('DeviceCMYK'));
    arr.push(PDFNumber.of(1));
    arr.push(PDFHexString.of('00000000ffffffff'));
    expect(resolveColorSpace(arr, classes, decodeRawStream)).toBeNull();
  });

  it('rejects Indexed whose lookup table is shorter than (hival+1) * baseComponents', () => {
    const ctx = PDFContext.create();
    const arr = PDFArray.withContext(ctx);
    arr.push(PDFName.of('Indexed'));
    arr.push(PDFName.of('DeviceRGB'));
    arr.push(PDFNumber.of(5)); // needs 6 entries * 3 bytes = 18 bytes
    arr.push(PDFHexString.of('0a141e')); // only 3 bytes
    expect(resolveColorSpace(arr, classes, decodeRawStream)).toBeNull();
  });

  it('resolves an Indexed lookup table stored as a FlateDecode stream', () => {
    const ctx = PDFContext.create();
    const paletteBytes = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    const dict = PDFDict.withContext(ctx);
    dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    const lookupStream = PDFRawStream.of(dict, deflateSync(Buffer.from(paletteBytes)));

    const arr = PDFArray.withContext(ctx);
    arr.push(PDFName.of('Indexed'));
    arr.push(PDFName.of('DeviceRGB'));
    arr.push(PDFNumber.of(1));
    arr.push(lookupStream);

    const info = resolveColorSpace(arr, classes, decodeRawStream);
    expect(info?.kind).toBe('indexed');
    if (info?.kind === 'indexed') expect(Array.from(info.palette)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rejects an Indexed lookup stream using an unsupported filter', () => {
    const ctx = PDFContext.create();
    const dict = PDFDict.withContext(ctx);
    dict.set(PDFName.of('Filter'), PDFName.of('LZWDecode'));
    const lookupStream = PDFRawStream.of(dict, Uint8Array.from([1, 2, 3]));

    const arr = PDFArray.withContext(ctx);
    arr.push(PDFName.of('Indexed'));
    arr.push(PDFName.of('DeviceRGB'));
    arr.push(PDFNumber.of(0));
    arr.push(lookupStream);

    expect(resolveColorSpace(arr, classes, decodeRawStream)).toBeNull();
  });
});
