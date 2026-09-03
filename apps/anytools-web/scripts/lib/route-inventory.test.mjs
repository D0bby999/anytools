import { describe, expect, it } from 'vitest';
import { buildRouteInventory } from './route-inventory.mjs';

// Plain .mjs (not .test.ts): this module is `node`-invoked directly by
// scripts/list-routes.mjs and scripts/release-gate.mjs (no TS runtime), and the repo's
// tsconfig has `allowJs: false` — a `.test.ts` file importing it would fail typecheck.
// vitest.config.ts include therefore lists `scripts/**/*.test.mjs` alongside the app's
// `src/**/*.test.ts`.

describe('buildRouteInventory', () => {
  const inventory = buildRouteInventory();

  it('finds all 107 published tool meta files', () => {
    expect(inventory.counts.toolMetaFiles).toBe(107);
  });

  it("counts the 35 tools restricted to English only (availableLocales: ['en'])", () => {
    // NOT the same as the phase plan's original assumption of "no tool sets this
    // field" — 35 tools shipped English-only bodies (thin-content SEO guard) after
    // that assumption was written. This is the reason toolPages below is 323, not
    // 107 x 4 = 428. See route-inventory.mjs's file header.
    expect(inventory.counts.localeRestrictedTools).toBe(35);
  });

  it('finds 13 populated clusters and 7 guide slugs', () => {
    expect(inventory.counts.clusters).toBe(13);
    expect(inventory.counts.guideSlugs).toBe(7);
  });

  it('computes 323 tool routes: 107 English + 72 each for vi/es/pt', () => {
    // 107 tools all ship English; 35 of them stop there, so the other 3 locales
    // only get 107 - 35 = 72 tool routes each. 107 + 72*3 = 323.
    expect(inventory.counts.toolPages).toBe(323);
  });

  it('adds up to 415 expect200 routes (4 home + 52 cluster + 323 tool + 4 guide index + 28 guide slug + 4 single-asset)', () => {
    expect(inventory.counts.home).toBe(4);
    expect(inventory.counts.clusterPages).toBe(52);
    expect(inventory.counts.guideIndexPages).toBe(4);
    expect(inventory.counts.guideSlugPages).toBe(28);
    expect(inventory.counts.singleAssetPages).toBe(4);
    expect(inventory.counts.total200).toBe(415);
    expect(inventory.expect200).toHaveLength(415);
  });

  it('lists exactly 10 blocked routes, 9 GET + 1 POST', () => {
    expect(inventory.counts.total404).toBe(10);
    expect(inventory.expect404).toHaveLength(10);
    const getCount = inventory.expect404.filter((r) => r.method === 'GET').length;
    const postCount = inventory.expect404.filter((r) => r.method === 'POST').length;
    expect(getCount).toBe(9);
    expect(postCount).toBe(1);
    expect(inventory.expect404).toContainEqual({
      path: '/api/newsletter/subscribe',
      method: 'POST',
    });
    expect(inventory.expect404).toContainEqual({ path: '/en/dashboard', method: 'GET' });
  });

  it('has no duplicate path+method pairs across expect200', () => {
    const keys = inventory.expect200.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never emits a route for an English-only tool under vi/es/pt', () => {
    // merge-pdf ships availableLocales: ['en'] — a regression here would mean the
    // enumerator started trusting all-4-locales again, silently reintroducing the
    // false-404 risk the phase file's own risk table calls out.
    expect(inventory.expect200).toContainEqual({ path: '/en/pdf/merge-pdf', method: 'GET' });
    expect(inventory.expect200).not.toContainEqual({ path: '/vi/pdf/merge-pdf', method: 'GET' });
    expect(inventory.expect200).not.toContainEqual({ path: '/es/pdf/merge-pdf', method: 'GET' });
    expect(inventory.expect200).not.toContainEqual({ path: '/pt/pdf/merge-pdf', method: 'GET' });
  });

  it('the /en/pdf/ slice is exactly 10 routes (all 10 PDF tools are English-only today)', () => {
    const enPdf = inventory.expect200.filter((r) => r.path.startsWith('/en/pdf/'));
    expect(enPdf).toHaveLength(10);
  });

  it('includes the 4 single-asset surfaces with no locale prefix', () => {
    for (const p of ['/api/health', '/sw.js', '/manifest.json', '/robots.txt']) {
      expect(inventory.expect200).toContainEqual({ path: p, method: 'GET' });
    }
  });
});
