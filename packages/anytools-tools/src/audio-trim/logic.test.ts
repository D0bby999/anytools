// @vitest-environment node
// Nothing here touches the DOM; Blob#arrayBuffer() is what needs a real Node runtime (see
// create-zip/logic.test.ts for the same note about happy-dom's Blob round trip).
import { describe, expect, it } from 'vitest';
import {
  AudioTrimError,
  MIN_TRIM_SECONDS,
  type PcmBuffer,
  encodeWav,
  estimateWavBytes,
  sliceChannels,
  trimToWav,
  validateRange,
} from './logic';

/** A minimal stand-in for AudioBuffer: one Float32Array per channel, fixed sample rate. */
function buffer(channels: number[][], sampleRate = 8000): PcmBuffer {
  return {
    sampleRate,
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    getChannelData: (ch: number) => Float32Array.from(channels[ch] ?? []),
  };
}

describe('validateRange', () => {
  it('clamps a selection to the clip boundaries', () => {
    expect(validateRange({ startSec: -1, endSec: 999 }, 10)).toEqual({
      startSec: 0,
      endSec: 10,
    });
  });

  it('rejects a start at or past the end', () => {
    expect(() => validateRange({ startSec: 5, endSec: 5 }, 10)).toThrow(AudioTrimError);
    expect(() => validateRange({ startSec: 8, endSec: 3 }, 10)).toThrow(
      expect.objectContaining({ code: 'rangeOutOfBounds' }),
    );
  });

  it('rejects a selection entirely past the clip', () => {
    expect(() => validateRange({ startSec: 12, endSec: 15 }, 10)).toThrow(AudioTrimError);
  });

  it('rejects a selection shorter than the minimum', () => {
    expect(() => validateRange({ startSec: 1, endSec: 1 + MIN_TRIM_SECONDS / 2 }, 10)).toThrow(
      expect.objectContaining({ code: 'rangeTooShort' }),
    );
  });

  it('accepts a selection right at the minimum', () => {
    expect(validateRange({ startSec: 1, endSec: 1 + MIN_TRIM_SECONDS }, 10).endSec).toBeCloseTo(
      1 + MIN_TRIM_SECONDS,
    );
  });
});

describe('sliceChannels', () => {
  it('slices every channel to the same sample-index range', () => {
    const buf = buffer([
      [0, 0.1, 0.2, 0.3, 0.4],
      [0, -0.1, -0.2, -0.3, -0.4],
    ]);
    const [left, right] = sliceChannels(buf, { startSec: 1 / 8000, endSec: 4 / 8000 });
    // Float32Array rounds inputs to float32 precision, so compare against the same rounding
    // rather than the original float64 literals.
    expect(Array.from(left ?? [])).toEqual(Array.from(Float32Array.from([0.1, 0.2, 0.3])));
    expect(Array.from(right ?? [])).toEqual(Array.from(Float32Array.from([-0.1, -0.2, -0.3])));
  });
});

describe('estimateWavBytes', () => {
  it('is the 44-byte header plus 16-bit samples per channel', () => {
    expect(estimateWavBytes(100, 2)).toBe(44 + 100 * 2 * 2);
    expect(estimateWavBytes(0, 1)).toBe(44);
  });
});

describe('encodeWav', () => {
  it('writes a well-formed RIFF/WAVE header matching the PCM data', async () => {
    const blob = encodeWav([Float32Array.from([0, 0.5, -0.5, 1])], 8000);
    expect(blob.size).toBe(44 + 4 * 2);
    const view = new DataView(await blob.arrayBuffer());
    const tag = (offset: number, len: number) =>
      String.fromCharCode(...Array.from({ length: len }, (_, i) => view.getUint8(offset + i)));
    expect(tag(0, 4)).toBe('RIFF');
    expect(tag(8, 4)).toBe('WAVE');
    expect(tag(12, 4)).toBe('fmt ');
    expect(tag(36, 4)).toBe('data');
    expect(view.getUint32(4, true)).toBe(36 + 8);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(view.getUint32(40, true)).toBe(8);
  });

  it('interleaves multi-channel samples in channel order', async () => {
    const blob = encodeWav(
      [Float32Array.from([0.5, -0.5]), Float32Array.from([0.25, -0.25])],
      44100,
    );
    const view = new DataView(await blob.arrayBuffer());
    expect(view.getInt16(44, true)).toBe(Math.round(0.5 * 0x7fff));
    expect(view.getInt16(46, true)).toBe(Math.round(0.25 * 0x7fff));
    expect(view.getInt16(48, true)).toBe(-Math.round(0.5 * 0x8000));
    expect(view.getInt16(50, true)).toBe(-Math.round(0.25 * 0x8000));
  });

  it('clips samples outside [-1, 1] instead of wrapping', async () => {
    const blob = encodeWav([Float32Array.from([1.5, -1.5])], 8000);
    const view = new DataView(await blob.arrayBuffer());
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });
});

describe('trimToWav', () => {
  it('validates, slices and encodes a selection end to end', async () => {
    const buf = buffer([[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]], 4);
    const result = trimToWav(buf, { startSec: 0.5, endSec: 2 });
    // 4 Hz, so [0.5s, 2s) → sample indices [2, 8) → 6 samples.
    expect(result.startSec).toBe(0.5);
    expect(result.endSec).toBe(2);
    expect(result.outputBytes).toBe(44 + 6 * 2);
    expect(result.blob.size).toBe(result.outputBytes);
  });

  it('surfaces AudioTrimError for a selection outside the clip', () => {
    const buf = buffer([[0, 0, 0, 0]], 4); // 1 second
    expect(() => trimToWav(buf, { startSec: 5, endSec: 6 })).toThrow(AudioTrimError);
  });
});
