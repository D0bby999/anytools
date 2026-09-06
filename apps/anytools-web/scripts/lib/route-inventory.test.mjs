import { describe, expect, it } from 'vitest';
import { buildRouteInventory } from './route-inventory.mjs';

// Plain .mjs (not .test.ts): this module is `node`-invoked directly by
// scripts/list-routes.mjs and scripts/release-gate.mjs (no TS runtime), and the repo's
// tsconfig has `allowJs: false` — a `.test.ts` file importing it would fail typecheck.
// vitest.config.ts include therefore lists `scripts/**/*.test.mjs` alongside the app's
// `src/**/*.test.ts`.

describe('buildRouteInventory', () => {
  const inventory = buildRouteInventory();

  // These assertions are deliberately arithmetic rather than literal counts. Every phase that
  // ships a tool moves 107/413/513, so hardcoding them turned this file into a merge conflict
  // on every branch and, worse, into a number people bumped without reading. What actually
  // needs guarding is that the parts still add up — a tool that lands in the registry but not
  // in the route list, or a locale gate that silently stops applying, breaks the arithmetic.
  it('counts one meta file per published tool, and never fewer than the 107 that shipped by 2026-09-06', () => {
    expect(inventory.counts.toolMetaFiles).toBeGreaterThanOrEqual(107);
  });

  it("counts the tools restricted to English only (availableLocales: ['en'])", () => {
    // 2026-09-05: widgets are localized, so the 30 tools that were gated to English while
    // their widget was English-only now serve in every locale (noindex until a body lands,
    // see has-localized-tool-body.ts). Only the five with English-only meta keep the gate,
    // and tools added since then ship all four locales.
    expect(inventory.counts.localeRestrictedTools).toBe(5);
  });

  it('finds 13 populated clusters and 7 guide slugs', () => {
    expect(inventory.counts.clusters).toBe(13);
    expect(inventory.counts.guideSlugs).toBe(7);
  });

  it('computes tool routes as English for every tool plus vi/es/pt for the unrestricted ones', () => {
    const { toolMetaFiles, localeRestrictedTools, toolPages } = inventory.counts;
    const unrestricted = toolMetaFiles - localeRestrictedTools;
    expect(toolPages).toBe(toolMetaFiles + unrestricted * (inventory.locales.length - 1));
  });

  it('adds up: total200 is the sum of every route family, and matches the emitted list', () => {
    const c = inventory.counts;
    expect(c.home).toBe(inventory.locales.length);
    expect(c.clusterPages).toBe(inventory.locales.length * c.clusters);
    expect(c.guideIndexPages).toBe(inventory.locales.length);
    expect(c.guideSlugPages).toBe(inventory.locales.length * c.guideSlugs);
    expect(c.localeUtilityPages).toBe(8);
    expect(c.singleAssetPages).toBe(4);
    expect(c.total200).toBe(
      c.home +
        c.clusterPages +
        c.toolPages +
        c.guideIndexPages +
        c.guideSlugPages +
        c.localeUtilityPages +
        c.singleAssetPages,
    );
    expect(inventory.expect200).toHaveLength(c.total200);
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

  it('every PDF tool served in English is also served in vi/es/pt, except the gated one', () => {
    const enPdf = inventory.expect200
      .filter((r) => r.method === 'GET' && r.path.startsWith('/en/pdf/'))
      .map((r) => r.path.slice('/en/pdf/'.length));
    expect(new Set(enPdf).size).toBe(enPdf.length);
    expect(enPdf.length).toBeGreaterThanOrEqual(10);
    // pdf-to-png is one of the five availableLocales: ['en'] tools; everything else in the
    // cluster must reach all four locales, or the locale gate has started leaking.
    const gated = ['pdf-to-png'];
    for (const slug of enPdf) {
      for (const l of ['vi', 'es', 'pt']) {
        const route = { path: `/${l}/pdf/${slug}`, method: 'GET' };
        if (gated.includes(slug)) expect(inventory.expect200).not.toContainEqual(route);
        else expect(inventory.expect200).toContainEqual(route);
      }
    }
  });

  it('includes the 4 single-asset surfaces with no locale prefix', () => {
    for (const p of ['/api/health', '/sw.js', '/manifest.json', '/robots.txt']) {
      expect(inventory.expect200).toContainEqual({ path: p, method: 'GET' });
    }
  });
});
