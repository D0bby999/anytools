/**
 * Enumerate every route the self-host build must serve, sourced from the registry
 * itself — NOT from `/sitemap.xml`.
 *
 * Why not the sitemap (see plans/260903-1527-anytools-selfhost-distribution/
 * phase-04-release-v1-gate.md, "Bộ liệt kê route"):
 *   (a) self-host returns 404 for /sitemap.xml on purpose (phase-01) — it cannot be
 *       the tool that verifies self-host is correct;
 *   (b) `sitemap.ts` deliberately drops tools without a localized body, so it is not
 *       a list of "routes that exist", it's a list of "routes worth indexing";
 *   (c) `sitemap.ts` emits `/{locale}/blog` unconditionally, and `/blog` 404s in
 *       self-host — a gate built on the sitemap could never go green.
 *
 * Ground truth is the same filter `generateStaticParams` in
 * `src/app/[locale]/[cluster]/[tool]/page.tsx` applies at build time:
 * `!meta.availableLocales || meta.availableLocales.includes(locale)`. A tool whose
 * meta sets `availableLocales: ['en']` (English-only content, to avoid shipping a
 * translated widget with no translated body) produces ONE route, not four. As of
 * 2026-09-04, 35 of 107 tools are English-only this way — the honest total is 323
 * tool routes, not 428 (107 × 4). See the enumerator's own unit test for the exact
 * breakdown; do not hand-edit the expected count without re-running this file.
 *
 * Parsed with plain regex against the `.ts` source, not a TS runtime import — this
 * file is invoked by `node` directly (`scripts/list-routes.mjs`,
 * `scripts/release-gate.mjs`), same technique the phase file specifies.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// this file lives at apps/anytools-web/scripts/lib/ — up 4 levels to repo root.
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// Non-locale, single-instance surfaces every self-host build must still serve.
const SINGLE_ASSET_PATHS = ['/api/health', '/sw.js', '/manifest.json', '/robots.txt'];

// Surfaces self-host must 404 (or, for the newsletter route, refuse the real method).
// GET routes first, then the one POST-only route — see phase-01 for why a bare GET
// against /api/newsletter/subscribe returns Next's own 405 on BOTH builds (no `GET`
// handler is exported at all) and is therefore not part of this list.
const BLOCKED_GET_PATHS = [
  '/en/sign-in',
  '/en/sign-up',
  '/en/dashboard',
  '/en/admin/distribution',
  '/en/blog',
  '/ads.txt',
  '/sitemap.xml',
  '/llms.txt',
  '/api/postclaw/health',
];
const BLOCKED_POST_PATH = '/api/newsletter/subscribe';

function readStringField(src, name) {
  const m = src.match(new RegExp(`^\\s*${name}:\\s*['"]([a-z0-9-]+)['"]`, 'm'));
  return m ? m[1] : undefined;
}

function readBooleanField(src, name) {
  const m = src.match(new RegExp(`^\\s*${name}:\\s*(true|false)`, 'm'));
  return m ? m[1] === 'true' : undefined;
}

function readLocaleArrayField(src, name) {
  const m = src.match(new RegExp(`^\\s*${name}:\\s*\\[([^\\]]*)\\]`, 'm'));
  if (!m) return undefined;
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

/** Read the locale list from the single source of truth, `@anytools/i18n`. */
function readLocales(repoRoot) {
  const file = path.join(repoRoot, 'packages/anytools-i18n/src/index.ts');
  const src = readFileSync(file, 'utf8');
  const m = src.match(/^\s*export const locales\s*=\s*\[([^\]]*)\]/m);
  if (!m) {
    throw new Error(
      `could not find "export const locales = [...]" in ${file} — locale source of truth moved, update route-inventory.mjs`,
    );
  }
  const locales = m[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  if (locales.length === 0) {
    throw new Error(`parsed an empty locale list from ${file}`);
  }
  return locales;
}

/** One row per `packages/anytools-tools/src/<dir>/meta.ts` that ships a published tool. */
function enumerateTools(repoRoot, locales) {
  const toolsSrcDir = path.join(repoRoot, 'packages/anytools-tools/src');
  const dirs = readdirSync(toolsSrcDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(path.join(toolsSrcDir, name, 'meta.ts')))
    .sort();

  const tools = [];
  for (const dir of dirs) {
    const file = path.join(toolsSrcDir, dir, 'meta.ts');
    const src = readFileSync(file, 'utf8');
    const cluster = readStringField(src, 'cluster');
    const slug = readStringField(src, 'slug');
    if (!cluster || !slug) {
      throw new Error(
        `${file}: could not find a "cluster:" and "slug:" field — cannot enumerate its route`,
      );
    }
    // Dark-launch flag (`published?: boolean`, default true) — see packages/anytools-tools/src/types.ts.
    const published = readBooleanField(src, 'published') ?? true;
    if (!published) continue;
    const availableLocales = readLocaleArrayField(src, 'availableLocales') ?? locales.slice();
    tools.push({ dir, cluster, slug, availableLocales });
  }
  return tools;
}

/** Clusters that actually have >=1 published tool — mirrors `POPULATED_CLUSTERS` in cluster-config.ts. */
function populatedClusters(tools) {
  return [...new Set(tools.map((t) => t.cluster))].sort();
}

/** Guide slugs, read straight off the English content directory (all 4 locales mirror it). */
function enumerateGuideSlugs(repoRoot) {
  const guidesDir = path.join(repoRoot, 'apps/anytools-web/content/en/guides');
  return readdirSync(guidesDir)
    .filter((f) => f.endsWith('.mdx'))
    .map((f) => f.slice(0, -'.mdx'.length))
    .sort();
}

function route(pathname, method = 'GET') {
  return { path: pathname, method };
}

/**
 * Build the full route inventory.
 * @param {{repoRoot?: string}} [opts]
 */
export function buildRouteInventory(opts = {}) {
  const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT;
  const locales = readLocales(repoRoot);
  const tools = enumerateTools(repoRoot, locales);
  const clusters = populatedClusters(tools);
  const guideSlugs = enumerateGuideSlugs(repoRoot);

  const expect200 = [];
  for (const locale of locales) expect200.push(route(`/${locale}`));
  for (const locale of locales) {
    for (const cluster of clusters) expect200.push(route(`/${locale}/${cluster}`));
  }
  for (const tool of tools) {
    for (const locale of tool.availableLocales)
      expect200.push(route(`/${locale}/${tool.cluster}/${tool.slug}`));
  }
  for (const locale of locales) expect200.push(route(`/${locale}/guides`));
  for (const locale of locales) {
    for (const slug of guideSlugs) expect200.push(route(`/${locale}/guides/${slug}`));
  }
  for (const p of SINGLE_ASSET_PATHS) expect200.push(route(p));

  const expect404 = [...BLOCKED_GET_PATHS.map((p) => route(p)), route(BLOCKED_POST_PATH, 'POST')];

  const toolPageCount = tools.reduce((n, t) => n + t.availableLocales.length, 0);

  return {
    generatedAt: new Date().toISOString(),
    locales,
    counts: {
      toolMetaFiles: tools.length,
      localeRestrictedTools: tools.filter((t) => t.availableLocales.length < locales.length).length,
      clusters: clusters.length,
      guideSlugs: guideSlugs.length,
      home: locales.length,
      clusterPages: locales.length * clusters.length,
      toolPages: toolPageCount,
      guideIndexPages: locales.length,
      guideSlugPages: locales.length * guideSlugs.length,
      singleAssetPages: SINGLE_ASSET_PATHS.length,
      total200: expect200.length,
      total404: expect404.length,
    },
    expect200,
    expect404,
  };
}
