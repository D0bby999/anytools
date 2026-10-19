// @vitest-environment node
/**
 * landing.test.ts
 * The public front door: signed-in visitors skip it, crawlers are told about
 * it and about nothing else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OG_VERSION } from "~/lib/tools/seo";

vi.mock("~/lib/env.server", () => ({ APP_URL: "https://learn.example.com", API_BASE: "", API_TOKEN: "", useSecureCookies: false }));
const getUserId = vi.fn();
vi.mock("~/lib/auth.server", () => ({ getUserId: (r: Request) => getUserId(r) }));

const landing = await import("~/routes/landing");
const home = await import("~/routes/home-redirect");
const robots = await import("~/routes/robots[.]txt");
const sitemap = await import("~/routes/sitemap[.]xml");

type LoaderArgs = Parameters<typeof landing.loader>[0];
const args = { request: new Request("https://learn.example.com/en"), params: { locale: "en" } } as unknown as LoaderArgs;
const bare = { request: new Request("https://learn.example.com/"), params: {} } as unknown as Parameters<typeof home.loader>[0];

beforeEach(() => getUserId.mockReset());

describe("landing", () => {
  it("sends a signed-in visitor to the app", async () => {
    getUserId.mockResolvedValue("user-1");
    // `/` sends them on; the landing page itself (/en) is public to anyone.
    const sent = await home.loader(bare);
    expect(sent).toBeInstanceOf(Response);
    expect(sent.headers.get("Location")).toBe("/home");
  });

  it("renders for a visitor, with a canonical URL, an OG image and SoftwareApplication JSON-LD", async () => {
    getUserId.mockResolvedValue(null);
    // data() wraps the body beside its headers (the language cookie).
    const { data } = (await landing.loader(args)) as unknown as { data: unknown };
    const tags = landing.meta({ data } as unknown as Parameters<typeof landing.meta>[0]) as Record<string, unknown>[];
    expect(tags).toContainEqual({ tagName: "link", rel: "canonical", href: "https://learn.example.com/en" });
    expect(tags).toContainEqual({ property: "og:image", content: `https://learn.example.com/og.png?v=${OG_VERSION}` });
    const ld = tags.find((t) => "script:ld+json" in t)?.["script:ld+json"] as Record<string, unknown>;
    expect(ld["@type"]).toBe("SoftwareApplication");
    expect(tags.some((t) => t.name === "robots")).toBe(false);
  });
});

describe("crawler files", () => {
  // AnyTools phase 2: the public tool pages joined the landing page here
  // (tools-public-routes.test.ts covers what they list).
  it("robots.txt allows only the landing page and the public tool pages, and names the sitemap", async () => {
    const body = await robots.loader().text();
    expect(body).toContain("Allow: /$");
    expect(body).toContain("Disallow: /");
    expect(body.split("\n").filter((l) => l.startsWith("Allow:"))).toEqual([
      "Allow: /$",
      "Allow: /?lng=",
      "Allow: /en$", "Allow: /en/", "Allow: /vi$", "Allow: /vi/",
      "Allow: /es$", "Allow: /es/", "Allow: /pt$", "Allow: /pt/",
    ]);
    expect(body).toContain("Sitemap: https://learn.example.com/sitemap.xml");
  });

  it("sitemap.xml lists the landing page and nothing private", async () => {
    const body = await sitemap.loader().text();
    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    // The landing page in each language; `/` only redirects, so it is not listed.
    for (const l of ["en", "vi", "es", "pt"]) expect(locs).toContain(`https://learn.example.com/${l}`);
    expect(locs).not.toContain("https://learn.example.com/");
    const priv = locs.filter((l) => !/^https:\/\/learn\.example\.com\/(en|vi|es|pt)(\/.*)?$/.test(l ?? ""));
    expect(priv).toEqual([]);
  });
});
