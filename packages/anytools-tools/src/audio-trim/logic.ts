/**
 * Cut a time range out of decoded audio and write it back out as a WAV file.
 *
 * Decoding happens in the UI (`AudioContext.decodeAudioData` via wavesurfer.js, which needs a
 * real `<canvas>` and does nothing under happy-dom). Everything below is plain arithmetic over
 * PCM sample arrays, so it is exercised directly with hand-built buffers in logic.test.ts.
 *
 * Output is WAV, never MP3: an MP3 encoder pure enough to license into this MIT repo would be
 * `lamejs`, and that package is LGPL-3.0 — a JS-only build has no separate object file a user
 * could relink, so none of LGPL-3.0's usual carve-outs apply. WAV needs no encoder at all, just
 * the ~44-byte header below.
 */
import { ToolError } from '../shared/tool-error';

/** The subset of `AudioBuffer` this module reads. Lets tests build one without a real decode. */
export type PcmBuffer = {
  sampleRate: number;
  numberOfChannels: number;
  length: number;
  getChannelData(channel: number): Float32Array;
};

export type TrimRange = { startSec: number; endSec: number };

/** Below this, a "trim" is really just noise — most of it would be zero samples either side. */
export const MIN_TRIM_SECONDS = 0.02;

export class AudioTrimError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'AudioTrimError';
  }
}

const fmtSec = (n: number) => `${n.toFixed(2)}s`;

/**
 * Check a user-drawn selection against the audio's real duration, and clamp float drift at the
 * very ends (a region dragged to the waveform edge lands at 29.999999997 rather than 30).
 */
export function validateRange(range: TrimRange, durationSec: number): TrimRange {
  const startSec = Math.max(0, range.startSec);
  const endSec = Math.min(durationSec, range.endSec);
  if (!(endSec > startSec)) {
    throw new AudioTrimError(
      'rangeOutOfBounds',
      `The selected range (${fmtSec(range.startSec)}–${fmtSec(range.endSec)}) is not inside the ${fmtSec(durationSec)} clip.`,
      { start: fmtSec(range.startSec), end: fmtSec(range.endSec), duration: fmtSec(durationSec) },
    );
  }
  if (endSec - startSec < MIN_TRIM_SECONDS) {
    throw new AudioTrimError(
      'rangeTooShort',
      `Select at least ${fmtSec(MIN_TRIM_SECONDS)} of audio — the current selection is ${fmtSec(endSec - startSec)}.`,
      { min: fmtSec(MIN_TRIM_SECONDS), got: fmtSec(endSec - startSec) },
    );
  }
  return { startSec, endSec };
}

/** Slice every channel of `buffer` to `range`, in samples rather than seconds internally. */
export function sliceChannels(buffer: PcmBuffer, range: TrimRange): Float32Array[] {
  const startIdx = Math.round(range.startSec * buffer.sampleRate);
  const endIdx = Math.min(buffer.length, Math.round(range.endSec * buffer.sampleRate));
  const out: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    out.push(buffer.getChannelData(ch).slice(startIdx, endIdx));
  }
  return out;
}

/** Bytes a 16-bit PCM WAV of this shape will occupy, header included. UI shows this up front. */
export function estimateWavBytes(sampleCount: number, numberOfChannels: number): number {
  return 44 + sampleCount * numberOfChannels * 2;
}

/**
 * Write interleaved 16-bit PCM samples with a standard 44-byte RIFF/WAVE header.
 *
 * `channels` must all share the same length (sliceChannels guarantees this — every channel is
 * sliced from the same sample-index range). Values are clamped to [-1, 1] before scaling: a
 * region straddling a mixed-down clip can carry samples fractionally past 1.0, which would
 * otherwise wrap around instead of clipping.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const numberOfChannels = channels.length;
  const sampleCount = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const blockAlign = numberOfChannels * bytesPerSample;
  const dataSize = sampleCount * blockAlign;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < sampleCount; i++) {
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const clamped = Math.max(-1, Math.min(1, channels[ch]?.[i] ?? 0));
      // Round rather than truncate: DataView#setInt16 truncates toward zero on a fractional
      // value, which would bias every sample down by up to half a step.
      const int16 = Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff);
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

export type TrimResult = { blob: Blob; startSec: number; endSec: number; outputBytes: number };

/** Validate, slice and encode in one call — what the UI's "Cut" button runs. */
export function trimToWav(buffer: PcmBuffer, range: TrimRange): TrimResult {
  const validated = validateRange(range, buffer.length / buffer.sampleRate);
  const sliced = sliceChannels(buffer, validated);
  const blob = encodeWav(sliced, buffer.sampleRate);
  return { blob, startSec: validated.startSec, endSec: validated.endSec, outputBytes: blob.size };
}
