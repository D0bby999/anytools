import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADSENSE_PUB_ID_FALLBACK, adsTxtBody, adsTxtLine } from './ads-txt';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const WORKER = join(REPO_ROOT, 'workers', 'ads-txt', 'src', 'index.js');

describe('ads.txt', () => {
  it('emits one valid authorized-seller record', () => {
    // Google rejects the file outright on a malformed record, and the failure surfaces
    // days later as "not found" in AdSense rather than as an error anyone can see.
    expect(adsTxtBody(ADSENSE_PUB_ID_FALLBACK)).toMatch(
      /^google\.com, pub-\d{16}, DIRECT, f08c47fec0942fa0\n$/,
    );
  });

  it('falls back to the placeholder only when there is no publisher at all', () => {
    expect(adsTxtBody('')).toContain('placeholder');
  });

  it('stays in step with the Cloudflare Worker that serves it at the edge', () => {
    // workers/ads-txt carries its own copy of the line because it deploys separately
    // from the app image. Nothing else would notice the two drifting: the Worker
    // shadows this route in production, so a stale publisher there would quietly serve
    // the wrong file while the repo looked correct.
    const worker = readFileSync(WORKER, 'utf8');
    expect(worker).toContain(adsTxtLine(ADSENSE_PUB_ID_FALLBACK).trimEnd());
  });
});
