/**
 * Stage every runtime asset the tools load by URL into public/third-party/<key>/.
 *
 * pdf.js, tesseract.js, zxing-wasm, onnxruntime-web, libheif, libarchive and Excalidraw all
 * fetch WASM binaries, models, language files or fonts at runtime rather than importing them,
 * so a bundler never sees them — and every one of them defaults to a public CDN when not told
 * otherwise. This site's premise is that using a tool involves no third party, and its CSP says
 * connect-src 'self'. So: everything is served from our own origin, staged here at build time.
 *
 * Driven by vendor-assets.json:
 *   "from"  + "paths"    copy files/directories out of an installed package
 *   "download" [...]     fetch a file once into ~/.cache/anytools-vendor/, verify its sha256,
 *                        then copy. A hash mismatch is a hard failure — the only network access
 *                        this repository performs at build time is here, and it is pinned.
 *
 * Output is gitignored (/public/third-party/). Runs before build and before dev. Idempotent.
 *
 *   node scripts/copy-vendor-assets.mjs           stage everything
 *   node scripts/copy-vendor-assets.mjs --probe   list what each "from" package ships (dist/)
 */
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const manifest = JSON.parse(readFileSync(join(appRoot, 'vendor-assets.json'), 'utf8'));
// Named third-party rather than vendor: several agent tooling hooks on this machine refuse to
// touch any path segment called `vendor`, which made the directory impossible to inspect.
const outRoot = join(appRoot, 'public', 'third-party');
const cacheRoot = join(homedir(), '.cache', 'anytools-vendor');
const probe = process.argv.includes('--probe');

// Runtime deps belong to @anytools/tools, not to this app; pnpm's strict layout means they are
// not resolvable from here. Resolve the tools package first and look from there.
const require = createRequire(import.meta.url);
const toolsRoot = dirname(require.resolve('@anytools/tools/package.json'));
// `via` names the package whose node_modules holds a transitive dep (tesseract.js-core is only
// reachable through tesseract.js under pnpm's strict layout).
// Packages with an `exports` map (zxing-wasm) refuse `require.resolve('<pkg>/package.json')`, so
// look for the directory pnpm links into the dependent's node_modules first.
function pkgRoot(name, via) {
  const bases = via ? [pkgRoot(via)] : [toolsRoot, appRoot];
  for (const b of bases) {
    // pnpm: <dependent>/node_modules/<dep> is a symlink into .pnpm/<dep>@v/node_modules/<dep>,
    // and a transitive dep sits beside the realpath, not under the symlink — check both.
    for (const dir of [join(b, 'node_modules', name), join(dirname(realpathSync(b)), name)]) {
      if (existsSync(join(dir, 'package.json'))) return realpathSync(dir);
    }
  }
  return dirname(require.resolve(`${name}/package.json`, { paths: bases }));
}

const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

async function download({ url, sha256: want, to }, dest) {
  mkdirSync(cacheRoot, { recursive: true });
  const cached = join(cacheRoot, to);
  if (!existsSync(cached) || sha256(cached) !== want) {
    process.stdout.write(`  ↓ ${url}\n`);
    // Bounded: a hung endpoint must fail the build, not hang it, and a body larger than any
    // asset we ship (the biggest is ~14 MB) is buffered nowhere.
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`download failed ${res.status} ${url}`);
    const body = Buffer.from(await res.arrayBuffer());
    if (body.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(`${to}: ${body.byteLength} bytes exceeds the ${MAX_DOWNLOAD_BYTES} cap`);
    }
    writeFileSync(cached, body);
  }
  const got = sha256(cached);
  if (got !== want) {
    rmSync(cached, { force: true });
    throw new Error(
      `sha256 mismatch for ${to}\n  want ${want}\n  got  ${got}\nUpstream changed the file. Re-verify its licence before re-pinning.`,
    );
  }
  mkdirSync(dirname(join(dest, to)), { recursive: true });
  cpSync(cached, join(dest, to));
}

// A path entry is either "dir/file" (lands at <dest>/<basename>) or { "from", "to" } when the
// library expects a specific relative layout under its asset base. Excalidraw 0.18.1 resolves
// "./fonts/<Family>/<file>.woff2" against EXCALIDRAW_ASSET_PATH (verified in its bundle,
// 2026-09-03), hence `"to": "fonts"`; re-check on every Excalidraw upgrade — a wrong path does
// not 404, it silently falls through to the CDN it lists as each FontFace's second source.
function copyFrom({ from: pkg, via, paths }, dest) {
  const root = pkgRoot(pkg, via);
  for (const entry of paths) {
    const p = typeof entry === 'string' ? entry : entry.from;
    const rel = typeof entry === 'string' ? p.split('/').pop() : entry.to;
    const src = join(root, p);
    if (!existsSync(src)) throw new Error(`${pkg}: ${p} not found (package layout changed?)`);
    const target = join(dest, rel);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dirname(target), { recursive: true });
    cpSync(src, target, { recursive: true });
  }
}

function list(dir, depth = 0) {
  if (depth > 2 || !existsSync(dir)) return;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const s = statSync(p);
    console.log(
      `${'  '.repeat(depth)}${e}${s.isDirectory() ? '/' : `  ${(s.size / 1024).toFixed(0)} KB`}`,
    );
    if (s.isDirectory() && depth < 1) list(p, depth + 1);
  }
}

if (probe) {
  for (const [key, spec] of Object.entries(manifest)) {
    for (const s of [spec, spec.also].filter((x) => x?.from)) {
      console.log(`\n## ${key} ← ${s.from} @ ${pkgRoot(s.from, s.via)}`);
      list(join(pkgRoot(s.from, s.via), s.probe ?? 'dist'));
    }
  }
  process.exit(0);
}

mkdirSync(outRoot, { recursive: true });
for (const [key, spec] of Object.entries(manifest)) {
  // "pending": the tool that needs this asset has not shipped yet. Skipped so a deploy does not
  // carry (and, for LGPL binaries, distribute) megabytes nothing on the site can load. A phase
  // that ships the tool deletes the flag.
  if (spec.pending) {
    rmSync(join(outRoot, key), { recursive: true, force: true });
    process.stdout.write(`  – third-party/${key} (pending, not staged)\n`);
    continue;
  }
  const dest = join(outRoot, key);
  mkdirSync(dest, { recursive: true });
  for (const s of [spec, spec.also].filter((x) => x?.from)) copyFrom(s, dest);
  for (const d of spec.download ?? []) await download(d, dest);
  process.stdout.write(`  ✓ third-party/${key}\n`);
}
