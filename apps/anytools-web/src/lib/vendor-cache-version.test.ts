/**
 * Guards the pairing between `apps/anytools-web/vendor-assets.json` (what gets staged under
 * `public/third-party/`) and `VENDOR_CACHE_VERSION`/`VENDOR_MANIFEST_SHA256` in
 * public/sw-policy.js. sw.js opens `at-vendor-v${VENDOR_CACHE_VERSION}` for everything under
 * `/third-party/` except the two onnx-loader-owned prefixes; if the manifest changes (a new
 * asset, a re-pinned version, a changed upstream URL) without bumping that version, a
 * returning visitor's browser keeps serving THE SAME cache-first bucket for a URL that may now
 * point at different bytes — nothing else in this codebase enforces that pairing (review
 * findings #2/#3).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const APP_ROOT = resolve(__dirname, '..', '..');
const SW_POLICY_PATH = resolve(APP_ROOT, 'public', 'sw-policy.js');
const VENDOR_MANIFEST_PATH = resolve(APP_ROOT, 'vendor-assets.json');

type SwPolicy = { VENDOR_CACHE_VERSION: number; VENDOR_MANIFEST_SHA256: string };

let SW_POLICY: SwPolicy;

beforeAll(async () => {
  await import(/* @vite-ignore */ SW_POLICY_PATH);
  SW_POLICY = (globalThis as unknown as { SW_POLICY: SwPolicy }).SW_POLICY;
});

describe('vendor-assets.json <-> sw-policy.js version pairing', () => {
  it('VENDOR_CACHE_VERSION is a positive integer', () => {
    expect(Number.isInteger(SW_POLICY.VENDOR_CACHE_VERSION)).toBe(true);
    expect(SW_POLICY.VENDOR_CACHE_VERSION).toBeGreaterThan(0);
  });

  it('fails the moment vendor-assets.json changes without a recorded-hash + version bump', () => {
    const liveContents = readFileSync(VENDOR_MANIFEST_PATH, 'utf8');
    const liveSha256 = createHash('sha256').update(liveContents).digest('hex');
    expect(liveSha256).toBe(SW_POLICY.VENDOR_MANIFEST_SHA256);
  });
});
