// @vitest-environment node
/**
 * libarchive.js's worker and wasm are served from ui/web/tool-runtime, not bundled: the worker
 * resolves the wasm against its own URL, so both must sit side by side under a stable name.
 * These are copies of the installed package's files, so pin them to it: a version bump that
 * forgets the folder fails here instead of loading a worker that does not match its library.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORKER_URL } from './libarchive-session';

const pkgDir = resolve(process.cwd(), 'node_modules/libarchive.js');
const version = (JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8')) as { version: string }).version;

describe('libarchive run-time files', () => {
  it('names the installed version in the worker URL', () => {
    expect(WORKER_URL).toBe(`/tool-runtime/libarchive.js@${version}/worker-bundle.js`);
  });

  it.each(['worker-bundle.js', 'libarchive.wasm'])('%s is the installed package’s file, byte for byte', (name) => {
    const served = readFileSync(resolve(process.cwd(), `tool-runtime/libarchive.js@${version}`, name));
    const installed = readFileSync(resolve(pkgDir, 'dist', name));
    expect(served.equals(installed)).toBe(true);
  });
});
