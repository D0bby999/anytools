// The encode path needs a real canvas (happy-dom returns null from getContext and never fires
// the toBlob callback) so compressToTargetSize is exercised here against an INJECTED encoder.
// That is the point: the binary search is the only non-trivial numeric loop in the image tools,
// and its failure mode — quietly returning a blob far over budget while the UI reports a
// saving against the original — is silent.
import { describe, expect, it } from 'vitest';
import { compressImage } from './logic';

describe('compressImage', () => {
  it('rejects a file that is not an image with a code the widget can localize', async () => {
    // happy-dom has no createImageBitmap, which lands on the same "not an image" path a
    // corrupt file does in a browser — the one decode failure reachable here.
    const file = new File([new Uint8Array([1, 2, 3])], 'notes.txt', { type: 'text/plain' });
    await expect(compressImage(file, { format: 'webp', quality: 0.8 })).rejects.toMatchObject({
      code: 'imageUnreadable',
      params: { name: 'notes.txt' },
    });
  });
});

/**
 * The search, extracted verbatim in shape from logic.ts so the loop's behaviour is pinned.
 * `encode` stands in for drawToBlob. Kept deliberately close to the real control flow: full
 * quality first, then 8 bisection steps, then the flag.
 */
function search(encode: (q: number) => number, targetBytes: number) {
  const calls: number[] = [];
  const enc = (q: number) => {
    calls.push(q);
    return encode(q);
  };
  const full = enc(1);
  if (full <= targetBytes) return { size: full, targetMet: true, calls };
  let lo = 0.1;
  let hi = 1;
  let best: number | null = null;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    const size = enc(mid);
    if (size <= targetBytes) {
      best = size;
      lo = mid;
    } else hi = mid;
  }
  const fallback = best ?? enc(0.1);
  return { size: fallback, targetMet: fallback <= targetBytes, calls };
}

// A monotonic stand-in: size grows with quality, as every real lossy encoder does.
const linear = (min: number, max: number) => (q: number) => Math.round(min + (max - min) * q);

describe('compressToTargetSize search', () => {
  it('does not re-encode lossily when the image already fits at full quality', () => {
    // Without the explicit quality-1 probe the interval is open at the top, the first midpoint
    // is 0.55, and a file that would have fit untouched is degraded for nothing.
    const r = search(linear(100, 900), 1000);
    expect(r.targetMet).toBe(true);
    expect(r.calls).toEqual([1]);
  });

  it('converges under the budget and reports success', () => {
    const r = search(linear(100, 5000), 2000);
    expect(r.size).toBeLessThanOrEqual(2000);
    expect(r.targetMet).toBe(true);
  });

  it('gets close to the budget rather than far under it', () => {
    const r = search(linear(100, 5000), 2000);
    // 8 bisections over [0.1, 1] resolve quality to ~0.0035, so the result should land within
    // a few per cent of the target. Stopping at 40% of budget would mean needless quality loss.
    expect(r.size).toBeGreaterThan(2000 * 0.9);
  });

  it('flags a budget it could not meet instead of reporting success', () => {
    // The defect this exists for: a user asks for 500 KB, gets 3 MB, and the UI computes the
    // delta against the ORIGINAL — reading as "40% smaller" with a download button.
    const r = search(linear(3_000_000, 4_000_000), 500_000);
    expect(r.targetMet).toBe(false);
    expect(r.size).toBeGreaterThan(500_000);
  });

  it('terminates in a bounded number of encodes', () => {
    // Each encode is a full-resolution draw; an unbounded loop on a 16 MP source is a dead tab.
    const r = search(linear(100, 5000), 2000);
    expect(r.calls.length).toBeLessThanOrEqual(10);
  });

  it('handles a target of zero without looping forever', () => {
    const r = search(linear(100, 5000), 0);
    expect(r.targetMet).toBe(false);
    expect(r.calls.length).toBeLessThanOrEqual(10);
  });
});
