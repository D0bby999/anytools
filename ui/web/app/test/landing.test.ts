// @vitest-environment node
/**
 * landing.test.ts
 * The public front door: signed-in visitors skip it, crawlers are told about
 * it and about nothing else.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OG_VERSION } from "~/lib/tools/seo";

vi.mock("~/lib/env.server", () => ({ APP_URL: "https://learn.example.com", API_BASE: "", API_TOKEN: "" }));
const getUserId = vi.fn();
vi.mock("~/lib/auth.server", () => ({ getUserId: (r: Request) => getUserId(r) }));

const landing = await import("~/routes/landing");
const robots = await import("~/routes/robots[.]txt");
const sitemap = await import("~/routes/sitemap[.]xml");

type LoaderArgs = Parameters<typeof landing.loader>[0];
const args = { request: new Request("https://learn.example.com/"), params: {} } as unknown as LoaderArgs;

beforeEach(() => getUserId.mockReset());

describe("landing", () => {
  it("sends a signed-in visitor to the app", async () => {
    getUserId.mockResolvedValue("user-1");
    const thrown = await landing.loader(args).catch((r: unknown) => r);
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).headers.get("Location")).toBe("/home");
  });

  it("renders for a visitor, with a canonical URL, an OG image and SoftwareApplication JSON-LD", async () => {
    getUserId.mockResolvedValue(null);
    const data = await landing.loader(args);
    const tags = landing.meta({ data } as unknown as Parameters<typeof landing.meta>[0]) as Record<string, unknown>[];
    expect(tags).toContainEqual({ tagName: "link", rel: "canonical", href: "https://learn.example.com/" });
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
      "Allow: /en$", "Allow: /en/", "Allow: /vi$", "Allow: /vi/",
      "Allow: /es$", "Allow: /es/", "Allow: /pt$", "Allow: /pt/",
    ]);
    expect(body).toContain("Sitemap: https://learn.example.com/sitemap.xml");
  });

  it("sitemap.xml lists the landing page and nothing private", async () => {
    const body = await sitemap.loader().text();
    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toContain("https://learn.example.com/");
    const priv = locs.filter((l) => !/^https:\/\/learn\.example\.com\/((en|vi|es|pt)(\/.*)?)?$/.test(l ?? ""));
    expect(priv).toEqual([]);
  });
});
