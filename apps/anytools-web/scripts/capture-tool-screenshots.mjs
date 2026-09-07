#!/usr/bin/env node
/**
 * Capture light + dark screenshots of tool pages, deterministically.
 *
 * Written for the UI upgrade (plan `plans/260906-1735-tool-ui-upgrade-per-tool`): every phase
 * gates on "screenshot light+dark", and before this script the repo had no headless-browser
 * tooling at all — so that gate was owned by nobody and each capture would have been an
 * un-repeatable one-off. The Phase 8 anti-drift baseline is only worth having if the next
 * person can regenerate it the same way, which means the capture has to be a committed
 * command, not a session transcript.
 *
 * "The same way" is not "byte-identical": a generator tool renders a fresh random value on
 * every load, so `password-generator` and friends differ run to run by design. Layout,
 * spacing, colour and control chrome are what these images are for; compare those.
 *
 * Determinism is the whole point, so three things are pinned before the shutter:
 *   - `document.fonts.ready` — Inter and JetBrains Mono load async; capturing early yields a
 *     fallback-metrics render that differs run to run.
 *   - animations and transitions forced to 0s, and `prefers-reduced-motion: reduce` emulated,
 *     so nothing is caught mid-tween.
 *   - the theme is set through localStorage before first paint, because next-themes reads it
 *     there; flipping a toggle after load would capture the transition.
 *
 * Chrome is launched with `channel: 'chrome'` on purpose: Playwright's cached headless-shell is
 * missing on this machine and only the real Chrome channel launches.
 *
 * Usage:
 *   # against an already-running server
 *   node scripts/capture-tool-screenshots.mjs password-generator
 *   node scripts/capture-tool-screenshots.mjs password-generator xlsx-to-csv --out=../../plans/.../screenshots
 *   node scripts/capture-tool-screenshots.mjs --all-clusters --base=http://127.0.0.1:3130
 *   node scripts/capture-tool-screenshots.mjs password-generator --full   # whole page
 *
 * By default it shoots `<section id="tool">` — the widget, which is what the UI work changes.
 * `--full` shoots the entire page including the tutorial and FAQ prose.
 *
 * The slug is the tool directory name; the cluster is resolved from the tool registry so
 * callers never have to remember which cluster a tool lives in.
 *
 * Exit code: 0 when every requested capture succeeded, 1 otherwise.
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { enumerateTools } from './lib/route-inventory.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');

// Same source of truth, and same technique, as release-gate.mjs: the registry is read by
// parsing `meta.ts`, not by importing it. These scripts run under bare `node`, which cannot
// resolve the workspace's TypeScript entry points.
const TOOLS = enumerateTools(REPO_ROOT, ['en']);

/** One representative per cluster — the tool carrying the most control types. Phase 8 baseline. */
const CLUSTER_REPRESENTATIVES = [
  'password-generator',
  'xlsx-to-csv',
  'json-formatter',
  'jwt-sign-verify',
  'regex-tester',
  'bip39-mnemonic',
  'watermark-pdf',
  'watermark-image',
  'css-gradient-generator',
  'unit-converter',
  'timezone-converter',
  'currency-converter',
  'bmi-calculator',
];

const THEMES = ['light', 'dark'];
const VIEWPORT = { width: 1280, height: 900 };

function parseArgs(argv) {
  const out = {
    base: 'http://127.0.0.1:3000',
    out: resolve(HERE, '../screenshots'),
    slugs: [],
    full: false,
  };
  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      out.slugs.push(arg);
      continue;
    }
    const [key, value] = arg.replace(/^--/, '').split('=');
    if (key === 'base') out.base = value;
    else if (key === 'out') out.out = resolve(process.cwd(), value);
    else if (key === 'all-clusters') out.slugs.push(...CLUSTER_REPRESENTATIVES);
    else if (key === 'full') out.full = true;
    else throw new Error(`unknown flag: --${key}`);
  }
  if (out.slugs.length === 0) {
    throw new Error('no slugs given — pass tool slugs, or --all-clusters');
  }
  return out;
}

/** Tool slug -> `/en/<cluster>/<slug>`. Fails loudly rather than shooting a 404 page. */
function pathForSlug(slug) {
  const meta = TOOLS.find((t) => t.slug === slug);
  if (!meta) throw new Error(`unknown tool slug: ${slug}`);
  return `/en/${meta.cluster}/${meta.slug}`;
}

async function captureOne(browser, { base, outDir, slug, theme, full }) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    colorScheme: theme,
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
  });
  // next-themes reads localStorage on mount, and so does the cookie banner. Seeding both
  // before any document loads means the first paint is already correct — no toggle, no
  // transition to catch, and no consent dialog pinned over the bottom of the page. 'denied'
  // rather than 'granted' so no ad or analytics script contributes to the render.
  await context.addInitScript((t) => {
    try {
      // 'anytools:theme', not next-themes' default 'theme' — theme-provider.tsx sets a
      // custom storageKey. Getting this wrong is silent: every shot renders light and half
      // of them are labelled dark, which is worse than no baseline at all. The assertion
      // after load exists so that failure can never be silent again.
      window.localStorage.setItem('anytools:theme', t);
      window.localStorage.setItem('anytools:consent', 'denied');
    } catch {
      // Private-mode style storage refusal: colorScheme emulation above still applies.
    }
  }, theme);

  const page = await context.newPage();
  try {
    const url = new URL(pathForSlug(slug), base).toString();
    const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    if (!res || !res.ok()) {
      throw new Error(`${url} -> HTTP ${res ? res.status() : 'no response'}`);
    }

    // The theme is a class on <html> (globals.css binds the `dark:` variant to `.dark`, not
    // to prefers-color-scheme), so this is the only reliable check that the seed took.
    const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    if (isDark !== (theme === 'dark')) {
      throw new Error(
        `theme seed did not take: expected ${theme}, <html> ${isDark ? 'has' : 'lacks'} .dark`,
      );
    }

    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({
      content: `*, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }`,
    });

    const file = resolve(outDir, `${slug}-${theme}.png`);
    if (full) {
      await page.screenshot({ path: file, fullPage: true });
    } else {
      // `<section id="tool">` (tool-page-layout.tsx) wraps the widget and nothing else. That
      // is what this plan changes; the tutorial and FAQ prose below it is identical before
      // and after, and shooting it makes a 5000px image whose diff is mostly noise.
      const widget = page.locator('#tool');
      await widget.waitFor({ state: 'visible', timeout: 15_000 });
      await widget.screenshot({ path: file });
    }
    return { ok: true, slug, theme, file };
  } catch (err) {
    return { ok: false, slug, theme, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await context.close();
  }
}

async function main() {
  const { base, out: outDir, slugs, full } = parseArgs(process.argv.slice(2));
  await mkdir(outDir, { recursive: true });

  // Resolve every slug up front: a typo should fail before Chrome starts, not halfway through.
  for (const slug of slugs) pathForSlug(slug);

  const browser = await chromium.launch({ channel: 'chrome' });
  const results = [];
  try {
    for (const slug of slugs) {
      for (const theme of THEMES) {
        const r = await captureOne(browser, { base, outDir, slug, theme, full });
        results.push(r);
        console.log(r.ok ? `  ok   ${slug}-${theme}.png` : `  FAIL ${slug}-${theme}: ${r.error}`);
      }
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} captured -> ${outDir}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
