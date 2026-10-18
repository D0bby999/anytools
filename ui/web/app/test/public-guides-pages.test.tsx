/**
 * public-guides-pages.test.tsx
 * AnyTools phase 4: the guides, the AnyProfile page and the about, privacy,
 * terms and contact pages, in four languages. Their content is complete in
 * each, their pages tell crawlers what the tool pages do, nothing in the
 * Markdown runs, the merged privacy text covers both halves of the product,
 * and the landing page links the tools in the visitor's language.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it as baseIt, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub } from "react-router";

vi.mock("~/lib/env.server", () => ({ APP_URL: "https://anytools.example", API_BASE: "", API_TOKEN: "" }));
const getUserId = vi.fn(async (_r: Request) => null as string | null);
vi.mock("~/lib/auth.server", () => ({ getUserId: (r: Request) => getUserId(r) }));

import { initI18n, publicLngs, type PublicLng } from "~/lib/i18n";
import { toolsI18n } from "~/lib/tools/i18n";
import { toolsMessages } from "~/lib/tools/messages.server";
import { GUIDE_SLUGS, listGuides, loadGuide, loadPage, pageFileKeys, STATIC_PAGES } from "~/lib/tools/pages.server";
import { resetReleaseCache } from "~/lib/tools/anyprofile.server";

const guides = await import("~/routes/public.guides");
const guide = await import("~/routes/public.guide");
const page = await import("~/routes/public.page");
const anyprofile = await import("~/routes/public.anyprofile");
const landing = await import("~/routes/landing");

/** Rendering tests get room for a loaded machine; the 5-second default is not enough there. */
const it = (name: string, fn: () => unknown) => baseIt(name, { timeout: 30_000 }, fn);

const WEB_DIR = join(__dirname, "../..");
const readJson = (p: string) => JSON.parse(readFileSync(join(WEB_DIR, p), "utf8")) as unknown;

type Tag = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (fn: (args: any) => unknown, url: string, params: Record<string, string>, headers?: HeadersInit) =>
  fn({ request: new Request(`https://anytools.example${url}`, { headers }), params, context: {} });
const metaOf = (meta: unknown, data: unknown) => (meta as (a: { data: unknown }) => Tag[])({ data });
const hreflangs = (tags: Tag[]) => tags.filter((t) => t.rel === "alternate").map((t) => String(t.hrefLang));
const canonical = (tags: Tag[]) => tags.find((t) => t.rel === "canonical")?.href;
const ld = (tags: Tag[]) => tags.filter((t) => "script:ld+json" in t).map((t) => t["script:ld+json"] as Tag);

beforeAll(() => {
  initI18n("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetReleaseCache();
});

/** Renders a route's component with its real loader's data, inside its locale's i18n instance. */
async function renderRoute(mod: { default: unknown; loader: unknown }, url: string, pattern: string, params: Record<string, string>) {
  const locale = params.locale as PublicLng;
  const data = await call(mod.loader as never, url, params);
  const Stub = createRoutesStub([{ path: pattern, Component: mod.default as never, loader: () => data }]);
  const view = render(
    <I18nextProvider i18n={toolsI18n(locale, toolsMessages(locale))}>
      <Stub initialEntries={[url]} />
    </I18nextProvider>,
  );
  // A guide is a long Markdown document; on a loaded machine its first render takes seconds.
  await waitFor(() => expect(view.container.querySelector("h1")).not.toBeNull(), { timeout: 15_000 });
  return view;
}

/** Every key path of a JSON value, arrays by index, with each string's {{placeholders}}. */
function shape(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => shape(v, `${path}[${i}]`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => shape(v, path ? `${path}.${k}` : k));
  const vars = typeof value === "string" ? [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(",") : "";
  return [`${path}:${vars}`];
}

describe("the pages namespace", () => {
  it("is in all four locales with the same keys, lists and placeholders as English", () => {
    const en = shape(readJson("public/locales/en/pages.json"));
    for (const l of ["vi", "es", "pt"]) expect(shape(readJson(`public/locales/${l}/pages.json`)), l).toEqual(en);
  });

  it("has no empty string in any locale", () => {
    for (const l of publicLngs) {
      const text = JSON.stringify(readJson(`public/locales/${l}/pages.json`));
      expect(text, l).not.toContain('""');
    }
  });
});

describe("the content", () => {
  it("has every guide and every page in every locale, and no file nothing serves", () => {
    for (const l of publicLngs) {
      for (const slug of GUIDE_SLUGS) {
        const g = loadGuide(l, slug);
        expect(g?.title, `${l}/${slug}`).toBeTruthy();
        expect(g?.description, `${l}/${slug}`).toBeTruthy();
        expect(g?.readingTime, `${l}/${slug}`).toBeGreaterThan(0);
      }
      for (const p of STATIC_PAGES) {
        const doc = loadPage(l, p);
        expect(doc?.title, `${l}/${p}`).toBeTruthy();
        expect(doc?.description, `${l}/${p}`).toBeTruthy();
        expect(doc?.updated, `${l}/${p}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
    const served = new Set([
      ...publicLngs.flatMap((l) => GUIDE_SLUGS.map((s) => `/content/${l}/guides/${s}.mdx`)),
      ...publicLngs.flatMap((l) => STATIC_PAGES.map((p) => `/content/${l}/pages/${p}.md`)),
    ]);
    expect(pageFileKeys().filter((k) => !served.has(k))).toEqual([]);
    expect(pageFileKeys()).toHaveLength(served.size);
  });

  it("drops a guide's own title from its body, since the page shows it as the h1", () => {
    for (const l of publicLngs) {
      for (const slug of GUIDE_SLUGS) expect(loadGuide(l, slug)?.source, `${l}/${slug}`).not.toMatch(/^\s*#\s/);
    }
  });

  it("returns nothing for a slug or page that is not one", () => {
    expect(loadGuide("en", "../pages/privacy")).toBeNull();
    expect(loadGuide("en", "nope")).toBeNull();
    expect(loadGuide("fr", "regex-mastery")).toBeNull();
    expect(loadPage("fr", "privacy")).toBeNull();
  });

  it("lists the guides in the old site's order", () => {
    expect(listGuides("vi").map((g) => g.slug)).toEqual([...GUIDE_SLUGS]);
  });
});

describe("the merged privacy policy", () => {
  // Phrases that must appear in each language: what the tools keep, what the
  // app keeps, whose keys it uses, and how to delete everything.
  const MUST: Record<PublicLng, string[]> = {
    en: ["run in your browser", "sign in with Google or GitHub", "your key", "encrypted", "Settings → Account", "curl", "currency"],
    vi: ["chạy trong trình duyệt", "đăng nhập bằng Google hoặc GitHub", "khóa của bạn", "mã hóa", "Cài đặt → Tài khoản", "curl", "tiền tệ"],
    es: ["funcionan en tu navegador", "inicias sesión con Google o GitHub", "tu clave", "cifran", "Ajustes → Cuenta", "curl", "divisas"],
    pt: ["rodam no seu navegador", "entra com Google ou GitHub", "sua chave", "criptografadas", "Configurações → Conta", "curl", "moedas"],
  };

  it("covers the tools and the study app in all four languages", () => {
    for (const l of publicLngs) {
      const text = loadPage(l, "privacy")?.source ?? "";
      for (const phrase of MUST[l]) expect(text, `${l}: ${phrase}`).toContain(phrase);
    }
  });

  it("makes none of the old site's claims about services this one does not run", () => {
    for (const l of publicLngs) {
      for (const p of STATIC_PAGES) {
        const text = loadPage(l, p)?.source ?? "";
        for (const gone of ["AdSense", "Umami", "Resend", "newsletter", "security@anytools.world"]) {
          expect(text, `${l}/${p}: ${gone}`).not.toContain(gone);
        }
      }
    }
  });
});

describe("the guides pages", () => {
  it("index: every guide, canonical and four hreflang links", async () => {
    const data = (await call(guides.loader, "/es/guides", { locale: "es" })) as { guides: { slug: string }[]; seo: { title: string } };
    expect(data.guides).toHaveLength(7);
    expect(data.seo.title).toBe("Guías — AnyTools");
    const tags = metaOf(guides.meta, data);
    expect(canonical(tags)).toBe("https://anytools.example/es/guides");
    expect(hreflangs(tags)).toEqual(["en", "vi", "es", "pt", "x-default"]);
    expect(tags.find((t) => t.name === "robots")?.content).toMatch(/^index/);
  });

  it("a guide: Article and breadcrumb JSON-LD, a title Google shows whole, links kept in the reader's language", async () => {
    const data = (await call(guide.loader, "/vi/guides/encoding-encyclopedia", { locale: "vi", slug: "encoding-encyclopedia" })) as {
      source: string;
      locales: string[];
    };
    const tags = metaOf(guide.meta, data);
    expect(canonical(tags)).toBe("https://anytools.example/vi/guides/encoding-encyclopedia");
    expect(hreflangs(tags)).toEqual(["en", "vi", "es", "pt", "x-default"]);
    expect(ld(tags).map((x) => x["@type"])).toEqual(["Article", "BreadcrumbList"]);
    expect(ld(tags)[0]).toMatchObject({ inLanguage: "vi", dateModified: "2026-05-26" });
    expect(String(tags.find((t) => "title" in t)?.title).length).toBeLessThanOrEqual(60);
    // The English guide links tools the legacy way, unprefixed; they gain a locale.
    const en = (await call(guide.loader, "/en/guides/encoding-encyclopedia", { locale: "en", slug: "encoding-encyclopedia" })) as { source: string };
    expect(loadGuide("en", "encoding-encyclopedia")?.source).toContain("](/encoding/url-encode)");
    expect(en.source).not.toMatch(/\]\(\/encoding\//);
    expect(en.source).toContain("](/en/encoding/url-encode)");
  });

  it("an unknown guide is a 404", async () => {
    const thrown = await Promise.resolve()
      .then(() => call(guide.loader, "/en/guides/nope", { locale: "en", slug: "nope" }))
      .catch((e: unknown) => e);
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);
  });

  it("renders in Vietnamese with one h1, its sections as h2, and nothing that runs", async () => {
    const { container } = await renderRoute(guide, "/vi/guides/regex-mastery", "/:locale/guides/:slug", { locale: "vi", slug: "regex-mastery" });
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe("Thành Thạo Regex: Từ Cơ Bản Đến Chuyên Gia");
    expect(container.querySelectorAll("h2").length).toBeGreaterThan(3);
    expect(container.querySelector("script, img, iframe")).toBeNull();
    expect(screen.getByText(/20 phút đọc/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Tất cả hướng dẫn" }).getAttribute("href")).toBe("/vi/guides");
  });

  it("the index renders each guide as a link, in the page's language", async () => {
    await renderRoute(guides, "/pt/guides", "/:locale/guides", { locale: "pt" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Guias");
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toEqual(GUIDE_SLUGS.map((s) => `/pt/guides/${s}`));
  });
});

describe("about, privacy, terms and contact", () => {
  it("each answers in four languages with its own canonical and hreflang", async () => {
    for (const p of STATIC_PAGES) {
      for (const l of publicLngs) {
        const data = await call(page.loader, `/${l}/${p}`, { locale: l });
        const tags = metaOf(page.meta, data);
        expect(canonical(tags)).toBe(`https://anytools.example/${l}/${p}`);
        expect(hreflangs(tags)).toEqual(["en", "vi", "es", "pt", "x-default"]);
      }
    }
  });

  it("the module serves only the four pages it is registered for", async () => {
    const thrown = await Promise.resolve()
      .then(() => call(page.loader, "/en/blog", { locale: "en" }))
      .catch((e: unknown) => e);
    expect((thrown as Response).status).toBe(404);
  });

  it("renders the privacy policy in Spanish, with the date and a mailto link", async () => {
    const { container } = await renderRoute(page, "/es/privacy", "/:locale/privacy", { locale: "es" });
    expect(container.querySelector("h1")?.textContent).toBe("Política de privacidad");
    expect(screen.getByText("Última actualización: 2026-10-18")).toBeTruthy();
    expect(container.querySelector('a[href="mailto:chaudai621@gmail.com"]')).not.toBeNull();
    expect(container.querySelector("script, img")).toBeNull();
  });
});

describe("the AnyProfile page", () => {
  const SHA = "b".repeat(64);
  const release = {
    version: "1.4.0",
    date: "2026-10-20",
    assets: {
      "darwin-arm64": { url: "https://github.com/D0bby999/anyprofile/releases/download/v1.4.0/AnyProfile-macos-arm64.zip", sha256: "c".repeat(64) },
      "darwin-arm64-dmg": { url: "https://github.com/D0bby999/anyprofile/releases/download/v1.4.0/AnyProfile-macos-arm64.dmg", sha256: SHA },
      "windows-amd64": { url: "https://github.com/D0bby999/anyprofile/releases/download/v1.4.0/AnyProfile-amd64-installer.exe", sha256: SHA },
    },
  };

  it("links the builds latest.json names, with the version and checksums", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify(release)));
    await renderRoute(anyprofile, "/vi/anyprofile", "/:locale/anyprofile", { locale: "vi" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("AnyProfile");
    const mac = screen.getByRole("link", { name: /Mac/ });
    expect(mac.getAttribute("href")).toBe(release.assets["darwin-arm64-dmg"].url);
    expect(screen.getByText("Phiên bản 1.4.0, phát hành 2026-10-20")).toBeTruthy();
    const sums = screen.getByRole("region", { name: "Mã kiểm tra SHA-256" });
    expect(within(sums).getAllByText(SHA)).toHaveLength(2);
  });

  it("falls back to GitHub's latest download when latest.json cannot be read", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    const { container } = await renderRoute(anyprofile, "/en/anyprofile", "/:locale/anyprofile", { locale: "en" });
    expect(screen.getByRole("link", { name: /Download for Windows/ }).getAttribute("href")).toBe(
      "https://github.com/D0bby999/anyprofile/releases/latest/download/AnyProfile-amd64-installer.exe",
    );
    expect(screen.queryByRole("region", { name: "SHA-256 checksums" })).toBeNull();
    expect(container.querySelectorAll("ul li").length).toBeGreaterThan(6);
    // No ad slot, no third-party script.
    expect(container.querySelector("script, ins, iframe")).toBeNull();
  });

  it("has its own canonical and hreflang in four languages", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    const data = await call(anyprofile.loader, "/pt/anyprofile", { locale: "pt" });
    const tags = metaOf(anyprofile.meta, data);
    expect(canonical(tags)).toBe("https://anytools.example/pt/anyprofile");
    expect(hreflangs(tags)).toEqual(["en", "vi", "es", "pt", "x-default"]);
  });
});

describe("the merged landing page", () => {
  it("links the tool clusters in the browser's language, and says the page varies by it", async () => {
    const data = (await call(landing.loader, "/", {}, { "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8" })) as {
      toolsLocale: string;
      clusters: { id: string; count: number }[];
    };
    expect(data.toolsLocale).toBe("vi");
    expect(data.clusters.map((c) => c.id)).toContain("time-date");
    expect(data.clusters.every((c) => c.count > 0)).toBe(true);
    expect(landing.headers()).toEqual({ Vary: "Accept-Language" });

    const en = (await call(landing.loader, "/", {}, { "Accept-Language": "fr-FR" })) as { toolsLocale: string };
    expect(en.toolsLocale).toBe("en");
  });

  it("renders the clusters and the public links, in English", async () => {
    const data = await call(landing.loader, "/", {}, { "Accept-Language": "es" });
    const Stub = createRoutesStub([{ path: "/", Component: landing.default as never, loader: () => data }]);
    render(<Stub initialEntries={["/"]} />);
    await screen.findByRole("heading", { level: 1 });
    const tools = screen.getByRole("region", { name: "Appendix: free tools, no account" });
    expect(within(tools).getByRole("link", { name: /Time & Date/ }).getAttribute("href")).toBe("/es/time-date");
    expect(within(tools).getByRole("link", { name: "Browse all tools" }).getAttribute("href")).toBe("/es");
    const nav = screen.getByRole("navigation", { name: "More from AnyTools" });
    expect(within(nav).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/es/guides",
      "/es/anyprofile",
      "/es/about",
      "/es/privacy",
      "/es/terms",
      "/es/contact",
      "https://github.com/D0bby999/anytools",
    ]);
  });
});

describe("ported files speak this app's tokens", () => {
  it("no colour literal or old class vocabulary in the new routes", () => {
    const files = readdirSync(join(WEB_DIR, "app/routes")).filter((f) => /^public\.(guides?|page|anyprofile)\.tsx$/.test(f));
    expect(files).toHaveLength(4);
    for (const f of files) {
      const src = readFileSync(join(WEB_DIR, "app/routes", f), "utf8");
      expect(src, f).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(|bg-accent|border-input|ring-ring|text-\[\d+px\]|border-l-\d|rounded-full border bg-background/i);
    }
  });
});
