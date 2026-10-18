// @vitest-environment node
/**
 * public-continuity.test.ts
 * AnyTools phase 4: every URL of the old site's sitemap (saved 2026-10-18,
 * fixtures/old-anytools-urls.txt) still answers through this app's router:
 * 200 for what came over, 301 to the locale's tools home for what was
 * dropped, and every 301 lands on a 200.
 *
 * "The router" is the real route table: routes.ts turned into route objects
 * and served by React Router's static handler, which is what the server runs
 * for a request. So the test covers route ranking (a static `guides` against
 * `:cluster`, a `blog/*` splat against `:cluster/:tool`) as well as each
 * loader, and a route added later that shadows an old URL fails it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createStaticHandler, type RouteObject } from "react-router";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/env.server", () => ({ APP_URL: "https://anytools.example", API_BASE: "", API_TOKEN: "" }));

type Entry = { id?: string; path?: string; index?: boolean; file: string; children?: Entry[] };

const { default: routeConfig } = (await import("~/routes")) as unknown as { default: Entry[] };
const modules = import.meta.glob<Record<string, unknown>>("/app/routes/*.{ts,tsx}");

function toRouteObjects(entries: Entry[]): RouteObject[] {
  return entries.map((e) => {
    const load = modules[`/app/${e.file}`];
    if (!load) throw new Error(`routes.ts names a missing file: ${e.file}`);
    const lazy = async () => {
      const m = await load();
      // A module with no default export is a resource route: no component.
      return { loader: m.loader as never, Component: (m.default as never) ?? null };
    };
    const id = e.id ?? e.file.replace(/\.[^.]+$/, "");
    if (e.index) return { id, index: true, lazy } satisfies RouteObject;
    return { id, path: e.path, lazy, children: e.children ? toRouteObjects(e.children) : undefined } satisfies RouteObject;
  });
}

const handler = createStaticHandler([{ id: "root", path: "", children: toRouteObjects(routeConfig) }]);

type Answer = { status: number; location: string | null };

/** What the server answers for a GET of `path`, before any page is rendered. */
async function answer(path: string): Promise<Answer> {
  const result = await handler.query(new Request(`https://anytools.example${path}`));
  if (result instanceof Response) return { status: result.status, location: result.headers.get("Location") };
  return { status: result.statusCode, location: null };
}

const OLD_URLS = readFileSync(join(__dirname, "fixtures/old-anytools-urls.txt"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);

const DROPPED = /^\/(en|vi|es|pt)\/(blog|sign-in|sign-up|dashboard|favorites|admin|offline|newsletter)(\/|$)/;

beforeAll(() => {
  // The AnyProfile page reads the release's latest.json; no test reaches GitHub.
  vi.stubGlobal("fetch", async () => new Response("not found", { status: 404 }));
});

describe("the old site's URLs", () => {
  it("are the 704 saved from the live sitemap", () => {
    expect(OLD_URLS).toHaveLength(704);
    expect(new Set(OLD_URLS).size).toBe(704);
  });

  it("each answer 200, or 301 to the locale's tools home for a dropped section, and a 301 lands on a 200", { timeout: 120_000 }, async () => {
    const wrong: string[] = [];
    const counts = { ok: 0, moved: 0 };
    for (const path of OLD_URLS) {
      const first = await answer(path);
      if (DROPPED.test(path)) {
        const locale = path.split("/")[1];
        if (first.status !== 301 || first.location !== `/${locale}`) {
          wrong.push(`${path}: ${first.status} ${first.location ?? ""}, want 301 /${locale}`);
          continue;
        }
        const landed = await answer(first.location);
        if (landed.status !== 200) wrong.push(`${path} -> ${first.location}: ${landed.status}`);
        else counts.moved += 1;
      } else if (first.status !== 200) {
        wrong.push(`${path}: ${first.status} ${first.location ?? ""}`);
      } else {
        counts.ok += 1;
      }
    }
    expect(wrong).toEqual([]);
    // The blog was the only dropped section in the sitemap: 28 + 3 × 21 posts and indexes.
    expect(counts).toEqual({ ok: 704 - 91, moved: 91 });
  });
});

describe("the routes phase 4 added", () => {
  it("serve the guides, AnyProfile and the four pages in every locale", async () => {
    for (const locale of ["en", "vi", "es", "pt"]) {
      for (const page of ["guides", "guides/regex-mastery", "anyprofile", "about", "privacy", "terms", "contact"]) {
        expect((await answer(`/${locale}/${page}`)).status, `/${locale}/${page}`).toBe(200);
      }
    }
  });

  it("404 an unknown guide, a page in an unknown locale, and a dropped section in one", async () => {
    for (const path of ["/en/guides/nope", "/en/guides/regex-mastery.mdx", "/vi/guides/blog", "/fr/guides", "/fr/privacy", "/fr/anyprofile", "/xx/blog", "/fr/blog/a-post"]) {
      expect((await answer(path)).status, path).toBe(404);
    }
  });

  it("send every depth of a dropped section home, and only those sections", async () => {
    for (const path of ["/vi/blog", "/vi/blog/", "/es/blog/a/b/c", "/pt/sign-in", "/en/sign-up", "/en/dashboard", "/en/dashboard/settings", "/en/favorites", "/en/admin/distribution/brands/x/posts", "/en/offline", "/en/newsletter"]) {
      const a = await answer(path);
      expect(a, path).toEqual({ status: 301, location: `/${path.split("/")[1]}` });
    }
    // A name that only looks like one is not caught by the splat.
    expect((await answer("/en/blogs")).status).toBe(404);
    expect((await answer("/en/blog-post")).status).toBe(404);
  });

  it("leave the tool pages and the app's own routes where they were", async () => {
    expect((await answer("/en/time-date/cron-parser")).status).toBe(200);
    expect((await answer("/en/time-date")).status).toBe(200);
    expect((await answer("/en/nope")).status).toBe(404);
  });
});

describe("the footer", () => {
  it("links only to pages that answer 200, in every locale", async () => {
    const { FOOTER_LINKS } = await import("~/components/tools-site/public-shell");
    for (const locale of ["en", "vi", "es", "pt"] as const) {
      for (const link of FOOTER_LINKS.filter((l) => !l.external)) {
        const path = link.to(locale);
        expect((await answer(path)).status, path).toBe(200);
      }
    }
    expect(FOOTER_LINKS.map((l) => l.labelKey)).toEqual([
      "footer.guides",
      "footer.anyprofile",
      "footer.about",
      "footer.privacy",
      "footer.terms",
      "footer.contact",
      "site.sourceCode",
    ]);
  });
});
