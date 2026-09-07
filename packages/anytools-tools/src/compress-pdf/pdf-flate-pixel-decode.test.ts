// Ground-truth tests for the pure predictor/unpack/colour math behind compress-pdf's
// /FlateDecode support. Every case here has a HAND-COMPUTED expected result — the same method
// used to prove this against real PDFs before shipping (see logic.ts's module comment); this
// file is the automated form of that proof.
import { describe, expect, it } from 'vitest';
import {
  cmykToRgb,
  samplesToRgba,
  scaleSampleTo8Bit,
  undoPngPredictor,
  undoPredictor,
  unpackSamples,
} from './pdf-flate-pixel-decode';

describe('undoPngPredictor', () => {
  it('passes None (filter 0) rows through unchanged', () => {
    const data = Uint8Array.from([0, 10, 20, 0, 30, 40]); // 2 rows, rowBytes=2, tag 0 each
    expect(undoPngPredictor(data, 2, 1)).toEqual(Uint8Array.from([10, 20, 30, 40]));
  });

  it('undoes Up (filter 2) against the previous row', () => {
    const row0 = [10, 20];
    // row1 true = [15, 5]; Up-encoded = raw - prevRow
    const data = Uint8Array.from([0, ...row0, 2, (15 - 10) & 0xff, (5 - 20) & 0xff]);
    expect(undoPngPredictor(data, 2, 1)).toEqual(Uint8Array.from([10, 20, 15, 5]));
  });

  it('undoes Sub (filter 1) within a 2-component-per-pixel row (bpp=2)', () => {
    const row0 = [100, 150, 110, 140]; // 2 "pixels" of 2 components each
    const enc = row0.map((v, i) => (i >= 2 ? (v - (row0[i - 2] ?? 0)) & 0xff : v));
    const data = Uint8Array.from([1, ...enc]);
    expect(undoPngPredictor(data, 4, 2)).toEqual(Uint8Array.from(row0));
  });

  it('undoes Average (filter 3)', () => {
    const row0 = [100, 200];
    const row1True = [110, 90];
    const encRow1 = row1True.map((v, i) => {
      const a = i >= 1 ? (row1True[i - 1] ?? 0) : 0; // bpp=1
      const b = row0[i] ?? 0;
      return (v - ((a + b) >> 1)) & 0xff;
    });
    const data = Uint8Array.from([0, ...row0, 3, ...encRow1]);
    expect(undoPngPredictor(data, 2, 1)).toEqual(Uint8Array.from([...row0, ...row1True]));
  });

  it('undoes a Sub+Paeth mix across two rows (bpp=2) — proven against a real signed PDF, see logic.test.ts', () => {
    const bpp = 2;
    const row0 = [100, 150, 110, 140];
    const encRow0 = row0.map((v, i) => (i >= bpp ? (v - (row0[i - bpp] ?? 0)) & 0xff : v));
    const row1 = [90, 160, 95, 130];
    function paeth(a: number, b: number, c: number) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      if (pa <= pb && pa <= pc) return a;
      if (pb <= pc) return b;
      return c;
    }
    const encRow1 = row1.map((v, i) => {
      const a = i >= bpp ? (row1[i - bpp] ?? 0) : 0;
      const b = row0[i] ?? 0;
      const c = i >= bpp ? (row0[i - bpp] ?? 0) : 0;
      return (v - paeth(a, b, c)) & 0xff;
    });
    const data = Uint8Array.from([1, ...encRow0, 4, ...encRow1]);
    expect(undoPngPredictor(data, 4, bpp)).toEqual(Uint8Array.from([...row0, ...row1]));
  });
});

describe('undoPredictor', () => {
  it('returns the data unchanged for predictor 1 (none) or absent', () => {
    const data = Uint8Array.from([1, 2, 3]);
    expect(undoPredictor(data, 1, 3, 1)).toBe(data);
  });

  it('dispatches to the PNG path for any value 10-15', () => {
    const data = Uint8Array.from([0, 5, 6]);
    expect(undoPredictor(data, 15, 2, 1)).toEqual(Uint8Array.from([5, 6]));
  });

  it('returns null for TIFF predictor 2 — deliberately unsupported, no real sample to prove it', () => {
    expect(undoPredictor(Uint8Array.from([1, 2, 3]), 2, 3, 1)).toBeNull();
  });

  it('returns null for any other unrecognised predictor value', () => {
    expect(undoPredictor(Uint8Array.from([1, 2, 3]), 7, 3, 1)).toBeNull();
  });
});

describe('unpackSamples', () => {
  it('reads 8bpc samples directly', () => {
    const data = Uint8Array.from([10, 20, 30, 40]);
    expect(Array.from(unpackSamples(data, 2, 2, 1, 8))).toEqual([10, 20, 30, 40]);
  });

  it('unpacks 1bpc MSB-first, padding each row to a byte boundary', () => {
    // 3-pixel-wide, 1 component, 1 bit: row = 3 bits used of 1 byte, next row starts a NEW byte.
    const row0 = 0b101_00000; // bits: 1,0,1
    const row1 = 0b011_00000; // bits: 0,1,1
    const data = Uint8Array.from([row0, row1]);
    expect(Array.from(unpackSamples(data, 3, 2, 1, 1))).toEqual([1, 0, 1, 0, 1, 1]);
  });

  it('unpacks 2bpc values', () => {
    // 4 pixels, 2 bits each = 1 byte: 0b01_10_11_00
    const data = Uint8Array.from([0b01_10_11_00]);
    expect(Array.from(unpackSamples(data, 4, 1, 1, 2))).toEqual([1, 2, 3, 0]);
  });

  it('unpacks 4bpc values', () => {
    const data = Uint8Array.from([0xa5, 0x3c]); // pixels: 0xa,0x5,0x3,0xc
    expect(Array.from(unpackSamples(data, 4, 1, 1, 4))).toEqual([0xa, 0x5, 0x3, 0xc]);
  });

  it('unpacks 16bpc big-endian values', () => {
    const data = Uint8Array.from([0x01, 0x02, 0xff, 0xee]);
    expect(Array.from(unpackSamples(data, 2, 1, 1, 16))).toEqual([0x0102, 0xffee]);
  });

  it('unpacks multi-component (RGB) 8bpc rows', () => {
    const data = Uint8Array.from([255, 0, 0, 0, 255, 0]);
    expect(Array.from(unpackSamples(data, 2, 1, 3, 8))).toEqual([255, 0, 0, 0, 255, 0]);
  });
});

describe('scaleSampleTo8Bit', () => {
  it('is identity at 8 bits', () => {
    expect(scaleSampleTo8Bit(0, 8)).toBe(0);
    expect(scaleSampleTo8Bit(255, 8)).toBe(255);
    expect(scaleSampleTo8Bit(128, 8)).toBe(128);
  });

  it('maps 1-bit samples to 0 or 255', () => {
    expect(scaleSampleTo8Bit(0, 1)).toBe(0);
    expect(scaleSampleTo8Bit(1, 1)).toBe(255);
  });

  it('maps 16-bit samples proportionally', () => {
    expect(scaleSampleTo8Bit(0, 16)).toBe(0);
    expect(scaleSampleTo8Bit(65535, 16)).toBe(255);
  });
});

describe('cmykToRgb', () => {
  it('converts pure red (C0 M255 Y255 K0) to RGB red', () => {
    expect(cmykToRgb(0, 255, 255, 0)).toEqual([255, 0, 0]);
  });

  it('converts K=255 (full black) to RGB black regardless of CMY', () => {
    expect(cmykToRgb(0, 0, 0, 255)).toEqual([0, 0, 0]);
  });

  it('converts all-zero CMYK to white', () => {
    expect(cmykToRgb(0, 0, 0, 0)).toEqual([255, 255, 255]);
  });
});

describe('samplesToRgba', () => {
  it('replicates a single grey sample across R, G and B', () => {
    const samples = Uint16Array.from([128]);
    const rgba = samplesToRgba(samples, 1, 1, 1, 8, 'gray');
    expect(Array.from(rgba)).toEqual([128, 128, 128, 255]);
  });

  it('maps RGB components straight through', () => {
    const samples = Uint16Array.from([10, 20, 30]);
    const rgba = samplesToRgba(samples, 1, 1, 3, 8, 'rgb');
    expect(Array.from(rgba)).toEqual([10, 20, 30, 255]);
  });

  it('converts CMYK components via cmykToRgb', () => {
    const samples = Uint16Array.from([0, 255, 255, 0]); // red
    const rgba = samplesToRgba(samples, 1, 1, 4, 8, 'cmyk');
    expect(Array.from(rgba)).toEqual([255, 0, 0, 255]);
  });

  it('looks up Indexed samples in the palette by raw (unscaled) index', () => {
    const palette = Uint8Array.from([10, 20, 30, 200, 210, 220]);
    const samples = Uint16Array.from([1, 0]);
    const rgba = samplesToRgba(samples, 2, 1, 1, 8, 'indexed', palette);
    expect(Array.from(rgba)).toEqual([200, 210, 220, 255, 10, 20, 30, 255]);
  });

  it('always writes an opaque alpha (combining a real /SMask happens one level up)', () => {
    const rgba = samplesToRgba(Uint16Array.from([0, 0, 0]), 1, 1, 3, 8, 'rgb');
    expect(rgba[3]).toBe(255);
  });
});
