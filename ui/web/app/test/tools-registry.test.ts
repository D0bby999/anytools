// @vitest-environment node
/**
 * tools-registry.test.ts
 * AnyTools phase 2: the registry is complete before the UIs are, so the
 * catalog, the sitemap and search know every tool from the start.
 *
 * The old repo has 131 tool folders with a meta.ts (the plan's "132" counted
 * its `shared/` folder too). Each has a FAQ in all four languages; which ones
 * lack a tutorial, or fall under the body gate in a locale, is pinned below
 * so a change to the corpus is a visible diff rather than a silent one.
 */
import { readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { toolMetas } from "~/tools/meta-registry";
import { CLUSTER_ORDER, POPULATED_CLUSTERS } from "~/lib/tools/catalog";
import { contentFileKeys, hasLocalizedToolBody, loadToolContent } from "~/lib/tools/content.server";
import { publicLngs } from "~/lib/i18n";

const TOOLS_DIR = resolve(process.cwd(), "app/tools");
const folders = readdirSync(TOOLS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(TOOLS_DIR, d.name, "meta.ts")))
  .map((d) => d.name)
  .sort();

describe("the tool registry", () => {
  it("has all 131 metas, one per tool folder, in the folder named for its slug", () => {
    expect(toolMetas).toHaveLength(131);
    expect(folders).toHaveLength(131);
    expect(toolMetas.map((m) => m.slug).sort()).toEqual(folders);
  });

  it("has unique slugs", () => {
    const slugs = toolMetas.map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("files every tool under a known cluster, and every populated cluster has tools", () => {
    for (const m of toolMetas) expect(CLUSTER_ORDER, m.slug).toContain(m.cluster);
    expect(POPULATED_CLUSTERS).toHaveLength(13);
    expect(POPULATED_CLUSTERS).not.toContain("marketing");
    expect(POPULATED_CLUSTERS).not.toContain("ecommerce-vn");
  });

  it("gives every tool an English title and description, and names only known tools as next steps", () => {
    const slugs = new Set(toolMetas.map((m) => m.slug));
    for (const m of toolMetas) {
      expect(m.title.en, m.slug).toBeTruthy();
      expect(m.description.en, m.slug).toBeTruthy();
      for (const s of m.nextStepSuggestions ?? []) expect(slugs, `${m.slug} -> ${s.tool}`).toContain(s.tool);
    }
  });
});

describe("articles for each locale", () => {
  it("every content file belongs to a tool in the cluster its folder names", () => {
    const known = new Set(toolMetas.map((m) => `${m.cluster}/${m.slug}`));
    const orphans = contentFileKeys().filter((k) => {
      const m = /^\/content\/(?:en|vi|es|pt)\/tools\/([^/]+)\/(.+)-(?:faq|tutorial)\.mdx$/.exec(k);
      return !m || !known.has(`${m[1]}/${m[2]}`);
    });
    expect(orphans).toEqual([]);
  });

  it("every tool has a FAQ in all four locales", () => {
    const missing = publicLngs.flatMap((l) =>
      toolMetas.filter((m) => !loadToolContent(l, m.cluster, m.slug).faq).map((m) => `${l}/${m.slug}`),
    );
    expect(missing).toEqual([]);
  });

  it("reports the tutorials each locale lacks", () => {
    const counts = Object.fromEntries(
      publicLngs.map((l) => [l, toolMetas.filter((m) => !loadToolContent(l, m.cluster, m.slug).tutorial).length]),
    );
    // 131 tools; English has 38 tutorials. The rest of each locale's body is its FAQ.
    expect(counts).toEqual({ en: 93, vi: 97, es: 93, pt: 93 });
  });

  it("reports the tool pages the body gate keeps out of the index", () => {
    const thin = publicLngs.flatMap((l) =>
      toolMetas.filter((m) => !hasLocalizedToolBody(l, m.cluster, m.slug)).map((m) => `${l}/${m.slug}`),
    );
    expect(thin).toEqual([]);
  });
});
