// decodeFlateImage against REAL pdf-lib objects — the glue between colour-space resolution,
// predictor undo and /SMask combining. Pure predictor/unpack math is proven exhaustively in
// pdf-flate-pixel-decode.test.ts; colour-space classification in pdf-flate-colorspace.test.ts.
// This file proves the DICT-SHAPE decisions: what makes decodeFlateImage combine an /SMask,
// what makes it skip an image outright, and that DecodeParms/Predictor really gets applied.
import { deflateSync } from 'node:zlib';
import {
  PDFArray,
  PDFContext,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { type FlateDecodeDeps, decodeFlateImage } from './pdf-flate-image-decode';

const deps: FlateDecodeDeps = {
  PDFName,
  PDFArray,
  PDFRawStream,
  PDFHexString,
  PDFString,
  PDFNumber,
  PDFDict,
  decodePDFRawStream,
};

type RawStream = ReturnType<typeof PDFRawStream.of>;

/** Build a `/FlateDecode` image XObject stream. `configure` sets Width/Height/ColorSpace/etc;
 *  `samples` are the pixel bytes AFTER any predictor has already been applied (matching what a
 *  real encoder would have written before deflating). */
function flateImage(
  ctx: PDFContext,
  configure: (dict: ReturnType<typeof PDFDict.withContext>) => void,
  samples: Uint8Array,
): RawStream {
  const dict = PDFDict.withContext(ctx);
  dict.set(PDFName.of('Type'), PDFName.of('XObject'));
  dict.set(PDFName.of('Subtype'), PDFName.of('Image'));
  dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  configure(dict);
  return PDFRawStream.of(dict, deflateSync(Buffer.from(samples)));
}

function withSize(
  dict: ReturnType<typeof PDFDict.withContext>,
  width: number,
  height: number,
  bpc = 8,
) {
  dict.set(PDFName.of('Width'), PDFNumber.of(width));
  dict.set(PDFName.of('Height'), PDFNumber.of(height));
  dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(bpc));
}

describe('decodeFlateImage', () => {
  it('decodes a plain DeviceRGB 2x2 image with no predictor', () => {
    const ctx = PDFContext.create();
    const samples = Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
    const obj = flateImage(
      ctx,
      (d) => {
        withSize(d, 2, 2);
        d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
      },
      samples,
    );
    const result = decodeFlateImage(obj, deps);
    expect(result?.kind).toBe('rgb');
    expect(result?.hasAlpha).toBe(false);
    expect(Array.from(result?.rgba ?? [])).toEqual([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255,
    ]);
  });

  it('decodes a DeviceGray image, replicating grey across R/G/B', () => {
    const ctx = PDFContext.create();
    const obj = flateImage(
      ctx,
      (d) => {
        withSize(d, 1, 1);
        d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceGray'));
      },
      Uint8Array.from([128]),
    );
    const result = decodeFlateImage(obj, deps);
    expect(result?.kind).toBe('gray');
    expect(Array.from(result?.rgba ?? [])).toEqual([128, 128, 128, 255]);
  });

  it('decodes a DeviceCMYK image via the naive CMYK->RGB formula', () => {
    const ctx = PDFContext.create();
    const obj = flateImage(
      ctx,
      (d) => {
        withSize(d, 1, 1);
        d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceCMYK'));
      },
      Uint8Array.from([0, 255, 255, 0]), // red
    );
    const result = decodeFlateImage(obj, deps);
    expect(result?.kind).toBe('cmyk');
    expect(Array.from(result?.rgba ?? [])).toEqual([255, 0, 0, 255]);
  });

  it('decodes an ICCBased(N=3) image as RGB', () => {
    const ctx = PDFContext.create();
    const iccDict = PDFDict.withContext(ctx);
    iccDict.set(PDFName.of('N'), PDFNumber.of(3));
    const iccStream = PDFRawStream.of(iccDict, new Uint8Array());
    const arr = PDFArray.withContext(ctx);
    arr.push(PDFName.of('ICCBased'));
    arr.push(iccStream);

    const obj = flateImage(
      ctx,
      (d) => {
        withSize(d, 1, 1);
        d.set(PDFName.of('ColorSpace'), arr);
      },
      Uint8Array.from([10, 20, 30]),
    );
    const result = decodeFlateImage(obj, deps);
    expect(result?.kind).toBe('rgb');
    expect(Array.from(result?.rgba ?? [])).toEqual([10, 20, 30, 255]);
  });

  it('decodes an Indexed image via its palette', () => {
    const ctx = PDFContext.create();
    const arr = PDFArray.withContext(ctx);
    arr.push(PDFName.of('Indexed'));
    arr.push(PDFName.of('DeviceRGB'));
    arr.push(PDFNumber.of(1));
    arr.push(PDFHexString.of('ff0000' + '00ff00'));

    const obj = flateImage(
      ctx,
      (d) => {
        withSize(d, 2, 1);
        d.set(PDFName.of('ColorSpace'), arr);
      },
      Uint8Array.from([0, 1]),
    );
    const result = decodeFlateImage(obj, deps);
    expect(result?.kind).toBe('indexed');
    expect(Array.from(result?.rgba ?? [])).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it('applies a PNG predictor (Predictor 15) declared in /DecodeParms', () => {
    const ctx = PDFContext.create();
    // 2x1 DeviceGray, PNG-style with per-row tag byte, both rows using filter type 0 (None) —
    // the tag byte itself is what proves DecodeParms->Predictor really drove the row layout;
    // Sub/Up/Average/Paeth math is proven exhaustively in pdf-flate-pixel-decode.test.ts.
    const taggedRow = Uint8Array.from([0, 40, 60]); // tag=None, then 2 grey samples
    const obj = flateImage(
      ctx,
      (d) => {
        withSize(d, 2, 1);
        d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceGray'));
        const parms = PDFDict.withContext(ctx);
        parms.set(PDFName.of('Predictor'), PDFNumber.of(15));
        parms.set(PDFName.of('Colors'), PDFNumber.of(1));
        parms.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8));
        parms.set(PDFName.of('Columns'), PDFNumber.of(2));
        d.set(PDFName.of('DecodeParms'), parms);
      },
      taggedRow,
    );
    const result = decodeFlateImage(obj, deps);
    expect(Array.from(result?.rgba ?? [])).toEqual([40, 40, 40, 255, 60, 60, 60, 255]);
  });

  it('combines a same-size FlateDecode DeviceGray /SMask into the alpha channel', () => {
    const ctx = PDFContext.create();
    const smask = flateImage(
      ctx,
      (d) => {
        withSize(d, 1, 2);
        d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceGray'));
      },
      Uint8Array.from([0, 255]),
    );
    const obj = flateImage(
      ctx,
      (d) => {
        withSize(d, 1, 2);
        d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
        d.set(PDFName.of('SMask'), smask);
      },
      Uint8Array.from([200, 100, 50, 200, 100, 50]),
    );
    const result = decodeFlateImage(obj, deps);
    expect(result?.hasAlpha).toBe(true);
    expect(Array.from(result?.rgba ?? [])).toEqual([200, 100, 50, 0, 200, 100, 50, 255]);
  });

  it('skips the whole image when the /SMask size does not match the base image', () => {
    const ctx = PDFContext.create();
    const smask = flateImage(
      ctx,
      (d) => {
        withSize(d, 1, 1); // base below is 1x2 — mismatch
        d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceGray'));
      },
      Uint8Array.from([0]),
    );
    const obj = flateImage(
      ctx,
      (d) => {
        withSize(d, 1, 2);
        d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
        d.set(PDFName.of('SMask'), smask);
      },
      Uint8Array.from([1, 2, 3, 4, 5, 6]),
    );
    expect(decodeFlateImage(obj, deps)).toBeNull();
  });

  it('skips the whole image when the /SMask is not DeviceGray', () => {
    const ctx = PDFContext.create();
    const smask = flateImage(
      ctx,
      (d) => {
        withSize(d, 1, 1);
        d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB')); // not gray
      },
      Uint8Array.from([1, 2, 3]),
    );
    const obj = flateImage(
      ctx,
      (d) => {
        withSize(d, 1, 1);
        d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
        d.set(PDFName.of('SMask'), smask);
      },
      Uint8Array.from([1, 2, 3]),
    );
    expect(decodeFlateImage(obj, deps)).toBeNull();
  });

  it('skips an image that declares /Mask (stencil or colour-key, unproven, always skipped)', () => {
    const ctx = PDFContext.create();
    const maskStream = flateImage(
      ctx,
      (d) => {
        withSize(d, 1, 1, 1);
      },
      Uint8Array.from([0]),
    );
    const obj = flateImage(
      ctx,
      (d) => {
        withSize(d, 1, 1);
        d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB'));
        d.set(PDFName.of('Mask'), maskStream);
      },
      Uint8Array.from([1, 2, 3]),
    );
    expect(decodeFlateImage(obj, deps)).toBeNull();
  });

  it('skips an image with a non-default /Decode array', () => {
    const ctx = PDFContext.create();
    const obj = flateImage(
      ctx,
      (d) => {
        withSize(d, 1, 1);
        d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceGray'));
        const decodeArr = PDFArray.withContext(ctx);
        decodeArr.push(PDFNumber.of(1));
        decodeArr.push(PDFNumber.of(0));
        d.set(PDFName.of('Decode'), decodeArr);
      },
      Uint8Array.from([128]),
    );
    expect(decodeFlateImage(obj, deps)).toBeNull();
  });

  it('skips an unsupported /BitsPerComponent', () => {
    const ctx = PDFContext.create();
    const obj = flateImage(
      ctx,
      (d) => {
        withSize(d, 1, 1, 3); // not one of 1/2/4/8/16
        d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceGray'));
      },
      Uint8Array.from([5]),
    );
    expect(decodeFlateImage(obj, deps)).toBeNull();
  });

  it('skips an unsupported predictor (TIFF, value 2)', () => {
    const ctx = PDFContext.create();
    const obj = flateImage(
      ctx,
      (d) => {
        withSize(d, 2, 1);
        d.set(PDFName.of('ColorSpace'), PDFName.of('DeviceGray'));
        const parms = PDFDict.withContext(ctx);
        parms.set(PDFName.of('Predictor'), PDFNumber.of(2));
        d.set(PDFName.of('DecodeParms'), parms);
      },
      Uint8Array.from([10, 20]),
    );
    expect(decodeFlateImage(obj, deps)).toBeNull();
  });

  it('skips a multi-filter chain (Filter as an array, not the single Name /FlateDecode)', () => {
    const ctx = PDFContext.create();
    const dict = PDFDict.withContext(ctx);
    dict.set(PDFName.of('Subtype'), PDFName.of('Image'));
    const filterArr = PDFArray.withContext(ctx);
    filterArr.push(PDFName.of('ASCII85Decode'));
    filterArr.push(PDFName.of('FlateDecode'));
    dict.set(PDFName.of('Filter'), filterArr);
    withSize(dict, 1, 1);
    dict.set(PDFName.of('ColorSpace'), PDFName.of('DeviceGray'));
    const obj = PDFRawStream.of(dict, deflateSync(Buffer.from([128])));
    expect(decodeFlateImage(obj, deps)).toBeNull();
  });

  it('skips an image with an unresolvable colour space (e.g. an /ImageMask stencil, no /ColorSpace)', () => {
    const ctx = PDFContext.create();
    const obj = flateImage(
      ctx,
      (d) => {
        withSize(d, 1, 1, 1);
        d.set(PDFName.of('ImageMask'), PDFName.of('true'));
        // deliberately no /ColorSpace — matches a real stencil mask.
      },
      Uint8Array.from([0]),
    );
    expect(decodeFlateImage(obj, deps)).toBeNull();
  });
});
