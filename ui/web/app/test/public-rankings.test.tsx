/**
 * public-rankings.test.tsx
 * Verification suite for the user-first monthly rankings directory
 * (`/{locale}/rankings`), category leaderboards (`/{locale}/rankings/{category}`),
 * `/go/{slug}` affiliate redirect route, and the 4-criterion scoring model.
 */
import { describe, expect, it as baseIt, beforeAll, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub } from "react-router";

vi.mock("~/lib/env.server", () => ({
  APP_URL: "https://anytools.example",
  API_BASE: "",
  API_TOKEN: "",
  useSecureCookies: false,
}));

import { initI18n, publicLngs, type PublicLng } from "~/lib/i18n";
import { toolsI18n } from "~/lib/tools/i18n";
import { toolsMessages } from "~/lib/tools/messages.server";
import { computeUserScore, RANKING_CATEGORY_IDS } from "~/lib/tools/rankings";
import { listRankingCategories, loadRankingCategory, rankingFileKeys, resolveAffiliateTarget } from "~/lib/tools/rankings.server";
import { MAX_DESCRIPTION_CHARS, MAX_TITLE_CHARS } from "~/lib/tools/seo";

const rankingsRoute = await import("~/routes/public.rankings");
const categoryRoute = await import("~/routes/public.ranking-category");
const goRoute = await import("~/routes/go.$slug");

const it = (name: string, fn: () => unknown) => baseIt(name, { timeout: 30_000 }, fn);

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

async function renderRoute(
  mod: { default: unknown; loader: unknown },
  url: string,
  pattern: string,
  params: Record<string, string>,
) {
  const locale = params.locale as PublicLng;
  const data = await call(mod.loader as never, url, params);
  const Stub = createRoutesStub([{ path: pattern, Component: mod.default as never, loader: () => data }]);
  const view = render(
    <I18nextProvider i18n={toolsI18n(locale, toolsMessages(locale))}>
      <Stub initialEntries={[url]} />
    </I18nextProvider>,
  );
  await waitFor(() => expect(view.container.querySelector("h1")).not.toBeNull(), { timeout: 15_000 });
  return view;
}

describe("user-first ranking data & scoring model", () => {
  it("bundles all 5 categories across all 4 locales with deterministic userScore ordering", () => {
    expect(rankingFileKeys()).toHaveLength(RANKING_CATEGORY_IDS.length);
    for (const locale of publicLngs) {
      const categories = listRankingCategories(locale);
      expect(categories).toHaveLength(RANKING_CATEGORY_IDS.length);
      for (const summary of categories) {
        expect(summary.itemCount).toBeGreaterThanOrEqual(3);
        expect(summary.topPick).not.toBeNull();
        const detail = loadRankingCategory(locale, summary.slug);
        expect(detail).not.toBeNull();
        expect(detail!.month).toMatch(/^\d{4}-\d{2}$/);
        expect(detail!.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        for (let i = 0; i < detail!.items.length; i++) {
          const item = detail!.items[i]!;
          expect(item.rank).toBe(i + 1);
          expect(item.userScore).toBe(computeUserScore(item.criteria));
          expect(item.affiliatePath).toBe(`/go/${item.slug}`);
          const target = resolveAffiliateTarget(item.slug);
          expect(target?.url.startsWith("https://")).toBe(true);
          if (i > 0) {
            expect(detail!.items[i - 1]!.userScore).toBeGreaterThanOrEqual(item.userScore);
          }
        }
      }
    }
  });
});

describe("the /go/:slug affiliate redirect route", () => {
  it("redirects known slugs with 302 Found, X-Robots-Tag noindex/nofollow, and private no-store cache", async () => {
    const target = resolveAffiliateTarget("decodo-proxies");
    expect(target).not.toBeNull();
    const res = (await call(goRoute.loader, "/go/decodo-proxies?loc=vi&pos=1", { slug: "decodo-proxies" })) as Response;
    expect(res).toBeInstanceOf(Response);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(target!.url);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns 404 for unknown or malformed slugs", async () => {
    await expect(Promise.resolve().then(() => call(goRoute.loader, "/go/nonexistent-tool", { slug: "nonexistent-tool" }))).rejects.toMatchObject({
      status: 404,
    });
    await expect(Promise.resolve().then(() => call(goRoute.loader, "/go/..%2Fetc", { slug: "../etc" }))).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("the rankings directory page (/{locale}/rankings)", () => {
  it("renders in all 4 locales with canonical, hreflangs, title/description within SEO bounds, and BreadcrumbList JSON-LD", async () => {
    for (const locale of publicLngs) {
      const data = (await call(rankingsRoute.loader, `/${locale}/rankings`, { locale })) as {
        seo: { title: string; description: string };
      };
      expect(data.seo.title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
      expect(data.seo.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS);

      const tags = metaOf(rankingsRoute.meta, data);
      expect(canonical(tags)).toBe(`https://anytools.example/${locale}/rankings`);
      expect(hreflangs(tags)).toEqual(["en", "vi", "es", "pt", "x-default"]);
      expect(ld(tags)).toContainEqual(
        expect.objectContaining({
          "@type": "BreadcrumbList",
        }),
      );
    }
  });

  it("supports live search across categories and products plus category sorting", async () => {
    const { unmount } = await renderRoute(rankingsRoute, "/vi/rankings", "/:locale/rankings", { locale: "vi" });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Xếp hạng vì người dùng");

    const searchInput = screen.getByRole("searchbox");
    fireEvent.change(searchInput, { target: { value: "Hetzner" } });
    expect(screen.getAllByText("Hetzner Cloud").length).toBeGreaterThanOrEqual(1);

    const sortSelect = screen.getByLabelText("Sắp xếp danh mục") as HTMLSelectElement;
    fireEvent.change(sortSelect, { target: { value: "az" } });
    expect(sortSelect.value).toBe("az");
    unmount();
  });
});

describe("the category leaderboard page (/{locale}/rankings/{category})", () => {
  it("emits ItemList, BreadcrumbList, and FAQPage JSON-LD and 404s on unknown categories", async () => {
    for (const locale of publicLngs) {
      const data = await call(categoryRoute.loader, `/${locale}/rankings/proxies`, {
        locale,
        category: "proxies",
      });
      const tags = metaOf(categoryRoute.meta, data);
      expect(canonical(tags)).toBe(`https://anytools.example/${locale}/rankings/proxies`);
      expect(hreflangs(tags)).toEqual(["en", "vi", "es", "pt", "x-default"]);

      const schemas = ld(tags);
      expect(schemas.map((s) => s["@type"])).toEqual(["ItemList", "BreadcrumbList", "FAQPage"]);
    }

    await expect(
      Promise.resolve().then(() => call(categoryRoute.loader, "/en/rankings/unknown-cat", { locale: "en", category: "unknown-cat" })),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("filters by tag and free trial, sorts by criterion, copies coupon codes, and prints destination domains beside /go/ links", async () => {
    const { container, unmount } = await renderRoute(
      categoryRoute,
      "/en/rankings/proxies",
      "/:locale/rankings/:category",
      { locale: "en", category: "proxies" },
    );

    // Every outbound /go/ link has rel="sponsored noopener"
    const goLinks = [...container.querySelectorAll<HTMLAnchorElement>('a[href^="/go/"]')];
    expect(goLinks.length).toBeGreaterThanOrEqual(4);
    for (const a of goLinks) {
      expect(a.getAttribute("rel")).toBe("sponsored noopener");
    }

    // Destination domains are printed beside CTAs
    expect(screen.getByText("decodo.com")).toBeInTheDocument();
    expect(screen.getByText("oxylabs.io")).toBeInTheDocument();
    expect(screen.getByText("marsproxies.com")).toBeInTheDocument();

    // Filter by free trial only (IPRoyal and MarsProxies have freeTrial: false, so 5 -> 3 items)
    const freeTrialBtn = screen.getByRole("button", { name: "Free tier / trial only" });
    fireEvent.click(freeTrialBtn);
    expect(screen.getByText("Showing 3 of 5 tested products")).toBeInTheDocument();

    // Reset free trial filter and sort by Highest performance (Oxylabs has 9.8 performance vs Decodo 9.3)
    fireEvent.click(freeTrialBtn);
    const sortSelect = screen.getByLabelText("Rank by") as HTMLSelectElement;
    fireEvent.change(sortSelect, { target: { value: "performance" } });
    const itemHeadings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(itemHeadings[0]).toBe("Oxylabs");

    // Coupon copy button works
    const couponBtn = screen.getByRole("button", { name: /Copy code ANYTOOLS20/i });
    fireEvent.click(couponBtn);
    expect(screen.getByText("Copied")).toBeInTheDocument();

    unmount();
  });
});
