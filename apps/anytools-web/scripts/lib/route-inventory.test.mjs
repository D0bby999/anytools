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

  it("counts the 5 tools restricted to English only (availableLocales: ['en'])", () => {
    // 2026-09-05: widgets are localized, so the 30 tools that were gated to English while
    // their widget was English-only now serve in every locale (noindex until a body lands,
    // see has-localized-tool-body.ts). Only the five with English-only meta keep the gate.
    expect(inventory.counts.localeRestrictedTools).toBe(5);
  });

  it('finds 13 populated clusters and 7 guide slugs', () => {
    expect(inventory.counts.clusters).toBe(13);
    expect(inventory.counts.guideSlugs).toBe(7);
  });

  it('computes 413 tool routes: 107 English + 102 each for vi/es/pt', () => {
    // 107 tools all ship English; 5 of them stop there, so the other 3 locales
    // get 107 - 5 = 102 tool routes each. 107 + 102*3 = 413.
    expect(inventory.counts.toolPages).toBe(413);
  });

  it('adds up to 513 expect200 routes (4 home + 52 cluster + 413 tool + 4 guide index + 28 guide slug + 8 locale utility + 4 single-asset)', () => {
    expect(inventory.counts.home).toBe(4);
    expect(inventory.counts.clusterPages).toBe(52);
    expect(inventory.counts.guideIndexPages).toBe(4);
    expect(inventory.counts.guideSlugPages).toBe(28);
    expect(inventory.counts.localeUtilityPages).toBe(8);
    expect(inventory.counts.singleAssetPages).toBe(4);
    expect(inventory.counts.total200).toBe(513);
    expect(inventory.expect200).toHaveLength(513);
  });

  it('serves the service worker offline fallback and favorites in every locale', () => {
    for (const locale of inventory.locales) {
      expect(inventory.expect200).toContainEqual({ path: `/${locale}/offline`, method: 'GET' });
      expect(inventory.expect200).toContainEqual({ path: `/${locale}/favorites`, method: 'GET' });
    }
  });

  it('lists exactly 11 blocked routes, 10 GET + 1 POST', () => {
    expect(inventory.counts.total404).toBe(11);
    expect(inventory.expect404).toHaveLength(11);
    const getCount = inventory.expect404.filter((r) => r.method === 'GET').length;
    const postCount = inventory.expect404.filter((r) => r.method === 'POST').length;
    expect(getCount).toBe(10);
    expect(postCount).toBe(1);
    expect(inventory.expect404).toContainEqual({
      path: '/api/newsletter/subscribe',
      method: 'POST',
    });
    expect(inventory.expect404).toContainEqual({ path: '/en/dashboard', method: 'GET' });
    expect(inventory.expect404).toContainEqual({ path: '/api/auth/get-session', method: 'GET' });
  });

  it('has no duplicate path+method pairs across expect200', () => {
    const keys = inventory.expect200.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never emits a route for an English-only tool under vi/es/pt', () => {
    // gpa-calculator ships availableLocales: ['en'] — a regression here would mean the
    // enumerator started trusting all-4-locales again, silently reintroducing the
    // false-404 risk the phase file's own risk table calls out. merge-pdf, gated until
    // 2026-09-05, is the positive case: its widget is localized and it serves everywhere.
    expect(inventory.expect200).toContainEqual({
      path: '/en/lifestyle/gpa-calculator',
      method: 'GET',
    });
    for (const l of ['vi', 'es', 'pt']) {
      expect(inventory.expect200).not.toContainEqual({
        path: `/${l}/lifestyle/gpa-calculator`,
        method: 'GET',
      });
      expect(inventory.expect200).toContainEqual({ path: `/${l}/pdf/merge-pdf`, method: 'GET' });
    }
  });

  it('the /en/pdf/ slice is exactly 10 routes (10 PDF tools)', () => {
    const enPdf = inventory.expect200.filter((r) => r.path.startsWith('/en/pdf/'));
    expect(enPdf).toHaveLength(10);
  });

  it('includes the 4 single-asset surfaces with no locale prefix', () => {
    for (const p of ['/api/health', '/sw.js', '/manifest.json', '/robots.txt']) {
      expect(inventory.expect200).toContainEqual({ path: p, method: 'GET' });
    }
  });
});
