#!/usr/bin/env node
/**
 * Writes content/.lastmod.json: { "<locale>/tools/<cluster>/<slug>-faq.mdx": "<ISO date>", … }
 * — the last git commit date of every MDX file under content/.
 *
 * Why a generated file and not fs mtime: the CI checkout sets every file's mtime to
 * "now", so mtimes in the image are identical and Google ignores a sitemap whose
 * lastmod is the same everywhere. Git history is the only per-file signal that
 * survives the build, and it is not available at runtime (.git is in .dockerignore),
 * so the build job materialises it here before `docker build` (needs fetch-depth: 0).
 *
 * Absent or unreadable git history → no file is written and the sitemap simply omits
 * lastmod, which is what it did before 2026-09-06. Run from apps/anytools-web.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const contentRoot = join(process.cwd(), 'content');
const outFile = join(contentRoot, '.lastmod.json');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.mdx')) out.push(p);
  }
  return out;
}

const files = walk(contentRoot);
const dates = {};
try {
  for (const file of files) {
    const iso = execFileSync('git', ['log', '-1', '--format=%cI', '--', file], {
      encoding: 'utf8',
    }).trim();
    if (iso) dates[relative(contentRoot, file)] = iso;
  }
} catch (error) {
  console.warn(`generate-content-lastmod: git unavailable (${error.message}); skipping`);
  process.exit(0);
}

const distinct = new Set(Object.values(dates).map((d) => d.slice(0, 10)));
if (Object.keys(dates).length === 0 || distinct.size < 2) {
  // A shallow clone reports one commit date for everything, which is the very signal
  // Google discards. Better to ship no lastmod than a uniform one.
  console.warn(
    `generate-content-lastmod: ${distinct.size} distinct date(s) across ${files.length} files — shallow clone? not writing`,
  );
  try {
    unlinkSync(outFile);
  } catch {}
  process.exit(0);
}

writeFileSync(outFile, `${JSON.stringify(dates, null, 2)}\n`);
console.log(
  `generate-content-lastmod: ${Object.keys(dates).length} files, ${distinct.size} distinct dates`,
);
