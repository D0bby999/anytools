/**
 * Two guards for the "nothing leaves your device" promise.
 *
 * 1. Every key in vendor-assets.json produced a non-empty directory under public/third-party/. The
 *    copy script runs before dev and build; if a package changes its layout the script throws,
 *    but a stale checkout where it never ran would otherwise pass typecheck and ship a tool whose
 *    worker 404s at runtime.
 *
 * 2. No source file names a public CDN. tesseract.js, zxing-wasm, onnxruntime-web and Excalidraw
 *    all default to jsdelivr/unpkg/esm.sh/huggingface when not given an explicit path. The right
 *    fix is always to point them at /third-party/<key>/; the wrong fix — writing the CDN URL somewhere
 *    — is what this catches. Package manifests are excluded on purpose: the SheetJS tarball URL
 *    lives in package.json and is a build-time fetch, not a runtime one.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_ROOT = resolve(__dirname, '..', '..');
const REPO_ROOT = resolve(APP_ROOT, '..', '..');
const manifest = JSON.parse(readFileSync(join(APP_ROOT, 'vendor-assets.json'), 'utf8')) as Record<
  string,
  unknown
>;

const CDN =
  /(cdn\.jsdelivr\.net|unpkg\.com|esm\.sh|huggingface\.co|cdnjs\.cloudflare\.com|cdn\.sheetjs\.com|raw\.githubusercontent\.com)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs|js|json|css)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

describe('vendor assets', () => {
  it('every manifest key was staged into public/third-party/', () => {
    const missing = Object.entries(manifest)
      // "pending" keys belong to tools that have not shipped; the script deliberately skips them.
      .filter(([, spec]) => !(spec as { pending?: boolean }).pending)
      .map(([key]) => key)
      .filter((key) => {
        const dir = join(APP_ROOT, 'public', 'third-party', key);
        return !existsSync(dir) || readdirSync(dir).length === 0;
      });
    expect(
      missing,
      `Run \`pnpm --filter @anytools/web vendor:assets\`. Empty or missing: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('no source file points a library at a public CDN', () => {
    // Source roots plus next.config.ts (CSP allow-lists and rewrites live there). public/ is
    // deliberately NOT scanned: the staged third-party libraries themselves mention their own
    // CDN defaults in comments, which is exactly the default this test exists to override.
    const roots = [join(REPO_ROOT, 'packages', 'anytools-tools', 'src'), join(APP_ROOT, 'src')];
    const offenders = [...roots.flatMap((r) => walk(r)), join(APP_ROOT, 'next.config.ts')]
      .filter((f) => CDN.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(`${REPO_ROOT}/`, ''));
    expect(
      offenders,
      `These files reference a CDN. Point the library at /third-party/<key>/ (see docs/tool-runtime-verification.md):\n${offenders.map((o) => `  - ${o}`).join('\n')}`,
    ).toEqual([]);
  });
});
