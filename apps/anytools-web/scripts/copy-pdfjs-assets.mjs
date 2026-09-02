/**
 * Copy pdf.js's auxiliary resource directories into public/pdfjs/.
 *
 * pdf.js loads three sets of files at runtime by URL rather than by import, so a bundler
 * never sees them and they are simply absent unless copied:
 *
 *   cmaps/          predefined CMaps for CJK text using non-embedded fonts. Missing, the
 *                   worker throws "Built-in CMap parameters are not provided." — from
 *                   page.render(), outside openPdf's catch, so the raw internal message
 *                   reaches the user.
 *   standard_fonts/ the standard-14 fonts, needed when a PDF does not embed them.
 *   wasm/           the OpenJPEG decoder. Missing, JPEG 2000 images — routine in scans —
 *                   do not decode.
 *
 * 2.6 MB total, served from our own origin. No CDN: the whole premise of these tools is
 * that using them does not involve a third party.
 *
 * Runs before build and before dev (see package.json). Idempotent.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

// pdfjs-dist belongs to @anytools/tools, not to this app, and pnpm's strict layout means it is
// not resolvable from here directly. Resolve the tools package first and look from there.
const toolsRoot = dirname(require.resolve('@anytools/tools/package.json'));
const pdfjsRoot = dirname(
  require.resolve('pdfjs-dist/package.json', { paths: [toolsRoot, process.cwd()] }),
);
const target = join(process.cwd(), 'public', 'pdfjs');

const DIRS = ['cmaps', 'standard_fonts', 'wasm'];

mkdirSync(target, { recursive: true });
for (const dir of DIRS) {
  const from = join(pdfjsRoot, dir);
  if (!existsSync(from)) {
    // Loud, not silent: a renamed directory upstream would otherwise produce a build that
    // works until someone opens a CJK or JPEG 2000 document.
    console.error(`[copy-pdfjs-assets] MISSING ${from} — pdf.js layout changed?`);
    process.exitCode = 1;
    continue;
  }
  const to = join(target, dir);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}
console.log(`[copy-pdfjs-assets] copied ${DIRS.join(', ')} -> public/pdfjs/`);
