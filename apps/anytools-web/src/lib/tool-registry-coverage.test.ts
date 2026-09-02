/**
 * Repo-wide guards over the tool registry. Every one of these encodes a failure that
 * has actually shipped, and each was invisible to typecheck, lint and the unit suite.
 *
 * 1. English body coverage — a tool without prose renders a widget and nothing else.
 *    150 such pages reached the sitemap and Google declined the AdSense application
 *    for insufficient content (see has-localized-tool-body.ts).
 * 2. LOADERS parity — DynamicToolRenderer returns null on a miss, silently. The page
 *    still returns 200 with breadcrumb, FAQ and SoftwareApplication schema, and an
 *    empty div where the tool belongs. Worse than a 404: it is indexable and claims
 *    to be an application. `Record<string, ComponentType>` makes this a runtime hole,
 *    not a type error.
 * 3. exports parity — a tool missing from package.json "exports" fails only when
 *    something imports its subpath, i.e. at the dynamic import inside the renderer,
 *    i.e. in the browser.
 */
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toolMetas } from '@anytools/tools/meta';
import { describe, expect, it } from 'vitest';
import { MIN_BODY_WORDS, hasLocalizedToolBody } from './has-localized-tool-body';

const APP_ROOT = process.cwd();
const REPO_ROOT = join(APP_ROOT, '..', '..');

const published = toolMetas.filter((m) => m.published !== false);

describe('tool registry coverage', () => {
  it(`every published tool has an English body of at least ${MIN_BODY_WORDS} words`, () => {
    const missing = published
      .filter((m) => !hasLocalizedToolBody('en', m.cluster, m.slug))
      .map((m) => `${m.cluster}/${m.slug}`);
    expect(
      missing,
      `Tools with no usable English body. Write content/en/tools/<cluster>/<slug>-faq.mdx (>= ${MIN_BODY_WORDS} words, no TODO marker), or set published:false to hold the tool back:\n${missing.map((s) => `  - ${s}`).join('\n')}`,
    ).toEqual([]);
  });

  it('no shipped body file contains a TODO marker', () => {
    // hasLocalizedToolBody sums FAQ + tutorial, which is right for "is this page thin"
    // but leaves a hole here: a TODO-stubbed FAQ beside an existing tutorial still
    // clears the floor. Verified — stubbing chmod-calculator (FAQ only) fails the
    // coverage check above, stubbing jwt-decoder (FAQ + tutorial) did not. So scan
    // the files directly as well; a placeholder must never reach a shipped page.
    const files = globSync('content/*/tools/*/*.mdx', { cwd: APP_ROOT });
    // Without this the whole assertion passes vacuously if cwd ever moves (a root-level
    // vitest workspace would do it): zero files scanned compares [] to [] and goes green.
    expect(files.length, `glob matched nothing — cwd is ${APP_ROOT}`).toBeGreaterThan(200);
    const withTodo = files
      // Line-initial only — prose may legitimately mention TODO comments (regex-tester
      // does), and matching anywhere flagged two real pages.
      .filter((rel) => /^[ \t>*-]*TODO\b/m.test(readFileSync(join(APP_ROOT, rel), 'utf8')));
    expect(
      withTodo,
      `Placeholder copy in shipped body files — write it or delete the file (a missing file is correctly noindexed; a TODO one is not):\n${withTodo.map((s) => `  - ${s}`).join('\n')}`,
    ).toEqual([]);
  });

  it('every tool in the registry has a component in the dynamic renderer', () => {
    // Parsed rather than imported: dynamic-tool-renderer.tsx pulls in next/dynamic and
    // every tool's UI module, which is not something a node-side test should load.
    const src = readFileSync(
      join(APP_ROOT, 'src', 'components', 'dynamic-tool-renderer.tsx'),
      'utf8',
    );
    // Keys are quoted only when they contain a hyphen; `slugify:` is a bare identifier.
    // Requiring quotes here reported slugify as missing when it is registered fine.
    const registered = new Set(
      [...src.matchAll(/^\s*'?([a-z0-9-]+)'?:\s*dynamic\(/gm)].map((m) => m[1]),
    );
    const missing = published.filter((m) => !registered.has(m.slug)).map((m) => m.slug);
    expect(
      missing,
      `In toolMetas but absent from LOADERS — these render a blank, indexable page:\n${missing.map((s) => `  - ${s}`).join('\n')}`,
    ).toEqual([]);
  });

  it('every tool has a package.json subpath export', () => {
    const pkg = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages', 'anytools-tools', 'package.json'), 'utf8'),
    ) as { exports: Record<string, string> };
    const missing = published.filter((m) => !pkg.exports[`./${m.slug}`]).map((m) => m.slug);
    expect(
      missing,
      `Missing from @anytools/tools "exports" — the dynamic import fails in the browser:\n${missing.map((s) => `  - ${s}`).join('\n')}`,
    ).toEqual([]);
  });

  it('no two tools share a slug', () => {
    const seen = new Map<string, number>();
    for (const m of toolMetas) seen.set(m.slug, (seen.get(m.slug) ?? 0) + 1);
    expect([...seen.entries()].filter(([, n]) => n > 1).map(([s]) => s)).toEqual([]);
  });
});
