// @vitest-environment node
/**
 * tools-public-routes.test.ts
 * AnyTools phase 2: the public tool pages answer for the four locales and
 * nothing else, 404 like the old site did, tell crawlers the same thing in
 * the sitemap, the robots meta and hreflang, and send the app's Tools tab to
 * the visitor's language.
 */
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { OG_VERSION } from "~/lib/tools/seo";

vi.mock("~/lib/env.server", () => ({ APP_URL: "https://anytools.example", API_BASE: "", API_TOKEN: "" }));

// Phase 3 ports every tool, which leaves the "not ported yet" pages with no real example. The
// pdf cluster is held back here, as if its batch had not landed, so they stay exercised.
vi.mock("~/tools/ui-registry", async (importOriginal) => {
  const real = await importOriginal<typeof import("~/tools/ui-registry")>();
  const { toolMetas } = await import("~/tools/meta-registry");
  const heldBack = new Set(toolMetas.filter((m) => m.cluster === "pdf").map((m) => m.slug));
  const TOOL_UIS = Object.fromEntries(Object.entries(real.TOOL_UIS).filter(([slug]) => !heldBack.has(slug)));
  return { ...real, TOOL_UIS, isPorted: (slug: string) => Object.hasOwn(TOOL_UIS, slug) };
});

const layout = await import("~/routes/public.layout");
const home = await import("~/routes/public.home");
const cluster = await import("~/routes/public.cluster");
const tool = await import("~/routes/public.tool");
const og = await import("~/routes/public.tool-og");
const toolsTab = await import("~/routes/tools");
const sitemap = await import("~/routes/sitemap[.]xml");
const { localizeInternalHref, localizeArticleLinks } = await import("~/lib/tools/links.server");
const { runtimeFile } = await import("~/lib/tools/runtime-files.server");
const { bodyWordCount, isIndexableTool } = await import("~/lib/tools/content.server");
const { toolMetas } = await import("~/tools/meta-registry");
const { isPorted } = await import("~/tools/ui-registry");

type Tag = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (fn: (args: any) => unknown, url: string, params: Record<string, string>) =>
  fn({ request: new Request(`https://anytools.example${url}`), params, context: {} });

async function status(fn: () => unknown): Promise<number> {
  try {
    await fn();
    return 200;
  } catch (e) {
    if (e instanceof Response) return e.status;
    throw e;
  }
}

function metaOf<M extends (args: never) => unknown>(meta: M, data: unknown): Tag[] {
  return (meta as unknown as (a: { data: unknown }) => Tag[])({ data });
}

const hreflangs = (tags: Tag[]) =>
  tags.filter((t) => t.rel === "alternate").map((t) => `${String(t.hrefLang)} ${String(t.href)}`);
const content = (tags: Tag[], key: string, value: string) =>
  tags.find((t) => t[key] === value)?.content as string | undefined;
const ldTypes = (tags: Tag[]) =>
  tags.filter((t) => "script:ld+json" in t).map((t) => (t["script:ld+json"] as Tag)["@type"]);

describe("locales", () => {
  it("answers en, vi, es and pt, and 404s anything else", async () => {
    for (const locale of ["en", "vi", "es", "pt"]) {
      expect(await status(() => call(layout.loader, `/${locale}`, { locale }))).toBe(200);
    }
    for (const locale of ["fr", "EN", "eng", "favicon.ico", "home2"]) {
      expect(await status(() => call(layout.loader, `/${locale}`, { locale })), locale).toBe(404);
      expect(await status(() => call(home.loader, `/${locale}`, { locale })), locale).toBe(404);
    }
  });

  it("sends a non-English page only its own bundle", async () => {
    const en = (await call(layout.loader, "/en", { locale: "en" })) as { messages: unknown };
    const vi = (await call(layout.loader, "/vi", { locale: "vi" })) as { messages: { site: { home: string } } };
    expect(en.messages).toBeNull();
    expect(vi.messages.site.home).toBe("Trang chủ AnyTools");
  });
});

describe("the tools home", () => {
  it("lists every tool offered in the locale, and cleans what the URL asks for", async () => {
    const en = (await call(home.loader, "/en", { locale: "en" })) as { entries: unknown[] };
    const vi = (await call(home.loader, `/vi?q=${"x".repeat(300)}&cluster=bogus&sort=evil`, { locale: "vi" })) as {
      entries: { slug: string }[];
      initial: { query: string; cluster: string; sort: string };
    };
    expect(en.entries).toHaveLength(131);
    // gpa-calculator, grade-calculator, pdf-to-png, readability-analyzer and
    // tip-to-hourly-wage are English only.
    expect(vi.entries).toHaveLength(126);
    expect(vi.entries.map((e) => e.slug)).not.toContain("gpa-calculator");
    expect(vi.initial).toEqual({ query: "x".repeat(100), cluster: "all", sort: "popular" });
  });

  it("is canonical to itself, with hreflang for all four and x-default", async () => {
    const data = await call(home.loader, "/es", { locale: "es" });
    const tags = metaOf(home.meta, data);
    expect(tags).toContainEqual({ tagName: "link", rel: "canonical", href: "https://anytools.example/es" });
    expect(hreflangs(tags)).toEqual([
      "en https://anytools.example/en",
      "vi https://anytools.example/vi",
      "es https://anytools.example/es",
      "pt https://anytools.example/pt",
      "x-default https://anytools.example/en",
    ]);
    expect(content(tags, "name", "robots")).toMatch(/^index/);
    expect(ldTypes(tags)).toEqual(["WebSite"]);
  });
});

describe("cluster pages", () => {
  it("404 for an unknown cluster and for a cluster with no tools", async () => {
    for (const c of ["nope", "marketing", "ecommerce-vn", "blog"]) {
      expect(await status(() => call(cluster.loader, `/en/${c}`, { locale: "en", cluster: c })), c).toBe(404);
    }
    expect(await status(() => call(cluster.loader, "/vi/web3", { locale: "vi", cluster: "web3" }))).toBe(200);
  });

  it("are indexable where a ported tool has a body, and noindex where none is ported yet", async () => {
    const time = metaOf(cluster.meta, await call(cluster.loader, "/vi/time-date", { locale: "vi", cluster: "time-date" }));
    expect(content(time, "name", "robots")).toMatch(/^index/);
    expect(hreflangs(time)).toHaveLength(5);

    const pdf = metaOf(cluster.meta, await call(cluster.loader, "/en/pdf", { locale: "en", cluster: "pdf" }));
    expect(content(pdf, "name", "robots")).toBe("noindex, follow");
    expect(hreflangs(pdf)).toEqual([]);
    expect(pdf).toContainEqual({ tagName: "link", rel: "canonical", href: "https://anytools.example/en/pdf" });
  });
});

describe("tool pages", () => {
  const params = (locale: string, c: string, t: string) => ({ locale, cluster: c, tool: t });

  it("404 for an unknown tool, a tool under another cluster, and an English-only tool in another language", async () => {
    const cases: [string, string, string, number][] = [
      ["en", "time-date", "nope", 404],
      ["en", "web3", "cron-parser", 404],
      ["vi", "lifestyle", "gpa-calculator", 404],
      ["en", "lifestyle", "gpa-calculator", 200],
      ["fr", "time-date", "cron-parser", 404],
      ["pt", "time-date", "cron-parser", 200],
    ];
    for (const [l, c, t, want] of cases) {
      expect(await status(() => call(tool.loader, `/${l}/${c}/${t}`, params(l, c, t))), `${l}/${c}/${t}`).toBe(want);
    }
  });

  it("a ported tool: canonical, hreflang, OG image, three kinds of JSON-LD, a title that fits", async () => {
    const data = (await call(tool.loader, "/vi/time-date/timezone-converter", params("vi", "time-date", "timezone-converter"))) as {
      tutorial: string;
      locales: string[];
    };
    const tags = metaOf(tool.meta, data);
    const self = "https://anytools.example/vi/time-date/timezone-converter";
    expect(tags).toContainEqual({ tagName: "link", rel: "canonical", href: self });
    expect(hreflangs(tags)).toEqual([
      "en https://anytools.example/en/time-date/timezone-converter",
      "vi https://anytools.example/vi/time-date/timezone-converter",
      "es https://anytools.example/es/time-date/timezone-converter",
      "pt https://anytools.example/pt/time-date/timezone-converter",
      "x-default https://anytools.example/en/time-date/timezone-converter",
    ]);
    expect(content(tags, "property", "og:image")).toBe(`${self}/og.png?v=${OG_VERSION}`);
    expect(content(tags, "property", "og:locale")).toBe("vi");
    expect(content(tags, "name", "robots")).toMatch(/^index/);
    expect(ldTypes(tags)).toEqual(["SoftwareApplication", "BreadcrumbList", "FAQPage"]);
    const title = tags.find((t) => "title" in t)?.title as string;
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).toContain("Chuyển đổi Timezone");
    expect(data.tutorial.length).toBeGreaterThan(500);
    expect(data.locales).toEqual(["en", "vi", "es", "pt"]);
  });

  it("an English-only tool offers only English to the switcher and to hreflang", async () => {
    const data = (await call(tool.loader, "/en/lifestyle/gpa-calculator", params("en", "lifestyle", "gpa-calculator"))) as {
      locales: string[];
    };
    expect(data.locales).toEqual(["en"]);
  });

  it("a tool not ported yet is served, but noindex and with no alternates", async () => {
    const tags = metaOf(tool.meta, await call(tool.loader, "/en/pdf/merge-pdf", params("en", "pdf", "merge-pdf")));
    expect(content(tags, "name", "robots")).toBe("noindex, follow");
    expect(hreflangs(tags)).toEqual([]);
  });
});

describe("the sitemap", () => {
  it("lists the homes, indexable clusters and ported tools, each with its translations", async () => {
    const body = await sitemap.loader().text();
    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    // Phase 2's own: two clusters and eight tools in four languages.
    expect(locs.filter((l) => /\/(time-date|web3)(\/|$)/.test(l ?? ""))).toHaveLength(2 * 4 + 8 * 4);
    // The landing page, four homes, and every indexable cluster and tool in each language.
    const tools = ["en", "vi", "es", "pt"].flatMap((l) =>
      toolMetas.filter((m) => isIndexableTool(m, l)).map((m) => `${l}/${m.cluster}`),
    );
    // Phase 4: the guides index, seven guides, AnyProfile and the four static
    // pages, in four languages.
    expect(locs).toHaveLength(1 + 4 + new Set(tools).size + tools.length + (1 + 7 + 1 + 4) * 4);
    // Batch A (phase 3a): finance, health and lifestyle pages, an English-only tool in English only.
    expect(locs).toContain("https://anytools.example/vi/finance/loan-calculator");
    expect(locs).toContain("https://anytools.example/pt/health");
    expect(locs).toContain("https://anytools.example/en/lifestyle/gpa-calculator");
    expect(locs).not.toContain("https://anytools.example/vi/lifestyle/gpa-calculator");
    expect(locs).toContain("https://anytools.example/pt");
    expect(locs).toContain("https://anytools.example/es/web3");
    expect(locs).toContain("https://anytools.example/vi/web3/bip39-mnemonic");
    expect(locs).toContain("https://anytools.example/es/formatters");
    expect(locs).toContain("https://anytools.example/pt/text-regex/regex-tester");
    expect(locs).not.toContain("https://anytools.example/en/pdf");
    expect(locs).not.toContain("https://anytools.example/en/pdf/merge-pdf");
    expect(body).toContain(
      '<xhtml:link rel="alternate" hreflang="x-default" href="https://anytools.example/en/time-date/cron-parser"/>',
    );
  });
});

describe("the Tools tab", () => {
  const go = async (accept: string | null) => {
    const headers: Record<string, string> = accept === null ? {} : { "Accept-Language": accept };
    const res = (await toolsTab.loader({
      request: new Request("https://anytools.example/tools", { headers }),
      params: {},
      context: {},
    } as never)) as Response;
    return { location: res.headers.get("Location"), vary: res.headers.get("Vary") };
  };

  it("goes to the first language the browser ranks that the tools speak, else English", async () => {
    expect((await go("vi-VN,vi;q=0.9,en;q=0.8")).location).toBe("/vi");
    expect((await go("fr-FR,fr;q=0.9,es;q=0.5,en;q=0.4")).location).toBe("/es");
    expect((await go("en;q=0.1,pt-BR;q=0.8")).location).toBe("/pt");
    expect((await go("pt;q=0,de")).location).toBe("/en");
    expect((await go(null)).location).toBe("/en");
    expect((await go("de")).vary).toBe("Accept-Language");
  });
});

describe("article links", () => {
  it("point at the page that serves them, in the reader's locale where it is indexable", () => {
    expect(localizeInternalHref("/time-date/cron-parser", "vi")).toBe("/vi/time-date/cron-parser");
    expect(localizeInternalHref("/tools/time-date/cron-parser", "es")).toBe("/es/time-date/cron-parser");
    expect(localizeInternalHref("https://anytools.world/vi/web3/wallet-checker#faq", "pt")).toBe("/vi/web3/wallet-checker#faq");
    // Not ported yet, so not indexable in vi: the English page.
    expect(localizeInternalHref("/pdf/merge-pdf", "vi")).toBe("/en/pdf/merge-pdf");
    expect(localizeInternalHref("/guides/json", "es")).toBe("/es/guides/json");
    expect(localizeInternalHref("https://example.com/x", "vi")).toBe("https://example.com/x");
    expect(localizeInternalHref("//evil.example/x", "vi")).toBe("//evil.example/x");
    expect(localizeInternalHref("/home", "vi")).toBe("/home");
  });

  it("are left alone inside code", () => {
    const src = "See [cron](/time-date/cron-parser).\n\n```md\n[x](/time-date/cron-parser)\n```\n`[y](/web3/wallet-checker)`";
    expect(localizeArticleLinks(src, "vi")).toBe(
      "See [cron](/vi/time-date/cron-parser).\n\n```md\n[x](/time-date/cron-parser)\n```\n`[y](/web3/wallet-checker)`",
    );
  });
});

describe("the body gate's counter", () => {
  it("counts prose, not frontmatter or tags, and treats a TODO stub as empty", () => {
    expect(bodyWordCount("---\ntitle: x y z\n---\none two <b>three</b>")).toBe(3);
    expect(bodyWordCount("## FAQ\nTODO: write this")).toBe(0);
    // The Spanish word for "all" is not a stub marker.
    expect(bodyWordCount("**TODO lo que necesitas saber**")).toBe(5);
  });
});

describe("the Open Graph card", () => {
  it("is a 1200x630 PNG for a real tool, cached, and a 404 otherwise", async () => {
    const res = (await call(og.loader, "/vi/web3/eth-wei-converter/og.png", {
      locale: "vi",
      cluster: "web3",
      tool: "eth-wei-converter",
    })) as Response;
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toContain("max-age=86400");
    const png = new Uint8Array(await res.arrayBuffer());
    const view = new DataView(png.buffer);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630]);
    expect(await status(() => call(og.loader, "/vi/web3/nope/og.png", { locale: "vi", cluster: "web3", tool: "nope" }))).toBe(404);
    expect(
      await status(() => call(og.loader, "/vi/lifestyle/gpa-calculator/og.png", { locale: "vi", cluster: "lifestyle", tool: "gpa-calculator" })),
    ).toBe(404);
  }, 30_000);
});

describe("tool run-time files", () => {
  const root = mkdtempSync(join(tmpdir(), "tool-runtime-"));
  const outside = mkdtempSync(join(tmpdir(), "tool-runtime-outside-"));
  mkdirSync(join(root, "sqljs@1.14.2", "dist"), { recursive: true });
  writeFileSync(join(root, "sqljs@1.14.2", "dist", "sql.wasm"), "\0asm");
  writeFileSync(join(root, "sqljs@1.14.2", ".secret.wasm"), "x");
  writeFileSync(join(outside, "leak.wasm"), "leak");
  symlinkSync(join(outside, "leak.wasm"), join(root, "sqljs@1.14.2", "link.wasm"));
  symlinkSync(outside, join(root, "out@1.0.0"));
  writeFileSync(join(root, "sqljs@1.14.2", "notes.exe"), "x");
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it("serves a file under a versioned package folder, immutable for a year", async () => {
    const res = await runtimeFile(root, "sqljs@1.14.2/dist/sql.wasm");
    expect(res?.status).toBe(200);
    expect(res?.headers.get("Content-Type")).toBe("application/wasm");
    expect(res?.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(await res?.text()).toBe("\0asm");
  });

  it("refuses traversal, symlinks out of the root, dotfiles, unversioned folders and unknown types", async () => {
    for (const path of [
      "sqljs@1.14.2/../sqljs@1.14.2/dist/sql.wasm",
      "sqljs@1.14.2/%2e%2e/x.wasm",
      "sqljs@1.14.2/link.wasm",
      "out@1.0.0/leak.wasm",
      "sqljs@1.14.2/.secret.wasm",
      "sqljs/dist/sql.wasm",
      "sqljs@1.14.2",
      "sqljs@1.14.2/notes.exe",
      "sqljs@1.14.2/dist/missing.wasm",
      "sqljs@1.14.2/dist",
      "",
    ]) {
      expect(await runtimeFile(root, path), path).toBeNull();
    }
  });
});
