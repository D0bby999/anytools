/**
 * showcase.test.tsx
 * The public profile (the private design notes): the web's design
 * registry matches the server's, the editor sends the design it shows, the
 * public page shows only its blocks and marks the learner's words, and the
 * share card shows numbers only when the page does.
 */
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";

vi.mock("~/lib/env.server", () => ({ API_BASE: "http://api.internal:8080", API_TOKEN: "t", APP_URL: "https://anytools.world", useSecureCookies: false, isProduction: false }));
const requireUser = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireUser: (r: Request) => requireUser(r) }));
const api = { getMyShowcase: vi.fn(), saveShowcase: vi.fn(), deleteShowcase: vi.fn(), readShowcase: vi.fn() };
vi.mock("~/lib/showcase/api.server", () => api);
const card = vi.fn();
vi.mock("~/lib/tools/og-image.server", () => ({ renderShowcaseCard: (input: unknown) => card(input) }));
const { ApiError } = await import("~/lib/api.server");
const lib = await import("~/lib/showcase/design");
const editor = await import("~/routes/showcase");
const publicPage = await import("~/routes/u.$handle");
const og = await import("~/routes/u.$handle.og[.]png");
const { showcaseUrls } = await import("~/lib/tools/sitemap.server");

const stats: import("~/lib/showcase/design").ShowcaseStats = {
  as_of: "2026-10-22",
  since: "2026-01-05",
  summary: { days: 90, streak: 12, longest_streak: 30, week_goal: 4, weeks_in_a_row: 3, longest_weeks: 8, level: 7 },
  calendar: [{ day: "2026-10-21", count: 7 }],
  milestones: [{ kind: "days", target: 60, reached_on: "2026-08-01" }],
  outcomes: { long_term: 150, mastered: 9, explains_passed: 4, answered: 400, workouts: 20 },
};
const profile = (design: Partial<import("~/lib/showcase/design").Design> = {}): import("~/lib/showcase/design").ShowcaseProfile => ({
  handle: "minh",
  name: "Minh",
  headline: "Learning Go",
  published: true,
  indexed: false,
  design: { version: 1, theme: { accent: "ask" }, blocks: [{ type: "summary" }], ...design },
  updated_at: "2026-10-22T10:00:00Z",
});

const post = (fields: Record<string, string>) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request("http://localhost/showcase", { method: "POST", body });
};
const show = (element: React.ReactNode) =>
  render(<RouterProvider router={createMemoryRouter([{ path: "/", element, action: () => null }])} />);

beforeAll(() => initI18n("en"));
beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ userId: "u1", user: { id: "u1", language: "en" } });
});

describe("the design registry", () => {
  const go = readFileSync("../../internal/showcase/design.go", "utf8") + readFileSync("../../internal/showcase/showcase.go", "utf8");
  const goConst = (name: string) => Number(new RegExp(`\\b${name}\\s*=\\s*(\\d+)`).exec(go)?.[1]);

  it("offers the block types, accents and limits the server checks", () => {
    const goTypes = [...go.matchAll(/^\tBlock(\w+)\s+= "(\w+)"/gm)].map((m) => m[2]).sort();
    expect([...lib.BLOCK_TYPES].sort()).toEqual(goTypes);
    expect(/var Accents = \[\]string\{([^}]*)\}/.exec(go)?.[1]?.match(/"(\w+)"/g)?.map((s) => s.slice(1, -1))).toEqual([...lib.ACCENTS]);
    for (const type of lib.BLOCK_TYPES) {
      const spec = new RegExp(`Block${type[0]!.toUpperCase()}${type.slice(1)}:\\s*\\{max: (\\d+)(, data: true)?`).exec(go);
      expect(Number(spec?.[1]), type).toBe(lib.BLOCK_SPECS[type].max);
      expect(Boolean(spec?.[2]), type).toBe(lib.BLOCK_SPECS[type].data);
    }
    const limits: [keyof typeof lib.LIMITS, string][] = [
      ["blocks", "MaxBlocks"],
      ["name", "MaxName"],
      ["headline", "MaxHeadline"],
      ["aboutTitle", "MaxAboutTitle"],
      ["aboutBody", "MaxAboutBody"],
      ["links", "MaxLinks"],
      ["linkLabel", "MaxLinkLabel"],
      ["url", "MaxURL"],
    ];
    for (const [web, server] of limits) expect(lib.LIMITS[web], web).toBe(goConst(server));
    expect(lib.DESIGN_VERSION).toBe(goConst("DesignVersion"));
  });

  it("names every block and accent in four languages", () => {
    for (const lang of ["en", "vi", "es", "pt"]) {
      const words = JSON.parse(readFileSync(`public/locales/${lang}/showcase.json`, "utf8"));
      for (const type of lib.BLOCK_TYPES) expect(words.blocks[type]?.title, `${lang} ${type}`).toBeTruthy();
      for (const accent of lib.ACCENTS) expect(words.accents[accent], `${lang} ${accent}`).toBeTruthy();
    }
  });

  it("moves and limits blocks", () => {
    const d: import("~/lib/showcase/design").Design = { version: 1, theme: { accent: "reflect" }, blocks: [{ type: "summary" }, { type: "calendar" }] };
    expect(lib.move(d.blocks, 1, -1).map((b) => b.type)).toEqual(["calendar", "summary"]);
    expect(lib.move(d.blocks, 0, -1)).toBe(d.blocks);
    expect(lib.canAdd(d, "summary")).toBe(false);
    expect(lib.canAdd(d, "about")).toBe(true);
  });
});

describe("the editor", () => {
  it("saves the design it shows, and says a refusal in the server's words", async () => {
    api.saveShowcase.mockResolvedValue(profile());
    const design = JSON.stringify({ version: 1, theme: { accent: "ask" }, blocks: [{ type: "calendar" }] });
    const res = await editor.action({ request: post({ intent: "save", handle: "minh", name: "Minh", headline: "", published: "on", design }), params: {}, context: {} } as never);
    expect(res).toEqual({ saved: profile() });
    expect(api.saveShowcase).toHaveBeenCalledWith("u1", { handle: "minh", name: "Minh", headline: "", published: true, indexed: false, design: JSON.parse(design) });

    api.saveShowcase.mockRejectedValue(new ApiError(409, "that handle is taken; choose another", "handle_taken"));
    expect(await editor.action({ request: post({ intent: "save", handle: "minh", name: "M", design }), params: {}, context: {} } as never)).toEqual({
      error: "that handle is taken; choose another",
    });
    expect(api.saveShowcase).toHaveBeenLastCalledWith("u1", expect.objectContaining({ published: false }));

    expect(await editor.action({ request: post({ intent: "save", design: "{" }), params: {}, context: {} } as never)).toEqual({ unreadable: true });

    api.deleteShowcase.mockResolvedValue(undefined);
    expect(await editor.action({ request: post({ intent: "delete" }), params: {}, context: {} } as never)).toEqual({ deleted: true });
  });

  // The preview draws a year's calendar (371 squares) on every keystroke, so
  // under the full suite's load this takes more than the default 5 s.
  it("adds, orders and previews blocks before anything is saved", { timeout: 15_000 }, async () => {
    const loaderData = {
      mine: { profile: null, default_design: { version: 1, theme: { accent: "reflect" }, blocks: [{ type: "summary" }, { type: "calendar" }] }, stats },
      origin: "https://anytools.world",
    };
    const { container } = show(<editor.default loaderData={loaderData as never} actionData={undefined} params={{}} matches={[] as never} />);
    const design = () => JSON.parse((container.querySelector('input[name="design"]') as HTMLInputElement).value);

    // Search engines may list a new page unless the learner says otherwise.
    expect((screen.getByRole("checkbox", { name: /Let Google/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Public/ }) as HTMLInputElement).checked).toBe(false);
    await userEvent.type(screen.getByRole("textbox", { name: "Name shown" }), "Minh");
    const preview = within(screen.getByRole("region", { name: "Preview" }));
    expect(preview.getByRole("heading", { level: 2, name: "Minh" })).toBeTruthy();
    expect(preview.getByText("days in the current streak")).toBeTruthy();

    const up = screen.getByRole("button", { name: "Move A year of study up" });
    await userEvent.click(up);
    expect(design().blocks.map((b: { type: string }) => b.type)).toEqual(["calendar", "summary"]);
    // Focus follows the moved block; at the top its "up" is disabled, so its "down" takes it.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move A year of study down" }));
    expect(screen.getByText("Moved A year of study to place 1 of 2.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Move At a glance up" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move At a glance down" }));
    await userEvent.click(screen.getByRole("button", { name: "Move At a glance down" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move At a glance up" }));

    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Add a block" }), "about");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Text" }), "I study every morning.");
    expect(preview.getByText("I study every morning.")).toBeTruthy();
    expect(preview.getByText("In Minh's own words.")).toBeTruthy();

    await userEvent.click(screen.getByRole("radio", { name: "Plum" }));
    expect(design().theme.accent).toBe("practise");
    expect(container.querySelector("article[data-part]")?.getAttribute("data-part")).toBe("practise");

    await userEvent.click(screen.getByRole("button", { name: "Remove At a glance" }));
    expect(preview.queryByText("days in the current streak")).toBeNull();
    expect(screen.getByText("Removed At a glance.")).toBeTruthy();
    // The preview's block headings sit under its h2.
    expect(preview.getByRole("heading", { level: 3, name: "A year of study" })).toBeTruthy();
  });

  it("says when stored blocks could not be read", () => {
    const loaderData = { mine: { profile: profile(), dropped: 2, default_design: profile().design, stats }, origin: "https://anytools.world" };
    show(<editor.default loaderData={loaderData as never} actionData={undefined} params={{}} matches={[] as never} />);
    expect(screen.getByRole("note").textContent).toContain("2 blocks of your page could not be read");
  });
});

describe("the public page", () => {
  const load = (handle: string) =>
    publicPage.loader({ request: new Request(`http://localhost/u/${handle}?lang=en`), params: { handle }, context: {} } as never);

  it("is a 404 for a handle with no published page, said in the visitor's language, without asking for a malformed one", async () => {
    api.readShowcase.mockResolvedValue(null);
    const missing = await load("nobody");
    expect(missing).toMatchObject({ init: { status: 404 } });
    expect((missing.init?.headers as Record<string, string>)["Cache-Control"]).toBe("no-store");
    expect(await load("..%2Fetc")).toMatchObject({ init: { status: 404 } });
    expect(api.readShowcase).toHaveBeenCalledTimes(1);
    show(<publicPage.default loaderData={missing.data} params={{ handle: "nobody" }} matches={[] as never} />);
    expect(screen.getByRole("heading", { level: 1, name: "No public profile here" })).toBeTruthy();
  });

  it("shows only the page's blocks, says what was counted, and marks the learner's words and links", async () => {
    const p = profile({
      blocks: [
        { type: "milestones" },
        { type: "about", title: "", body: "Every morning." },
        { type: "links", links: [{ label: "My code", url: "https://github.com/minh" }] },
      ],
    });
    api.readShowcase.mockResolvedValue({ profile: p, stats: { ...stats, summary: null, calendar: null, outcomes: null } });
    const data = (await load("Minh")).data;
    expect(api.readShowcase).toHaveBeenCalledWith("minh");
    expect(publicPage.meta({ data } as never)).toEqual(
      expect.arrayContaining([
        { name: "robots", content: "noindex" },
        { name: "description", content: "Learning Go" },
        { property: "og:image", content: "https://anytools.world/u/minh/og.png?lang=en&v=2026-10-22" },
      ]),
    );
    expect(publicPage.meta({ data } as never).some((t) => "rel" in t && t.rel === "canonical")).toBe(false);
    show(<publicPage.default loaderData={data} params={{ handle: "minh" }} matches={[] as never} />);
    expect(screen.getByRole("heading", { level: 1, name: "Minh" })).toBeTruthy();
    expect(screen.getByText(/counted by AnyLearn from study recorded in it/)).toBeTruthy();
    expect(screen.getByText("60 study days")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "At a glance" })).toBeNull();
    expect(screen.getByText("In Minh's own words.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "My code (opens in a new tab)" });
    expect(link.getAttribute("rel")).toBe("nofollow ugc noopener noreferrer");
    expect(screen.getByRole("link", { name: "Learn with AnyLearn" }).getAttribute("href")).toBe("/en/anylearn");
  });

  it("lets search engines list a page its learner allows, with an address per language and a ProfilePage", async () => {
    const p = { ...profile({ blocks: [{ type: "links", links: [{ label: "Code", url: "https://github.com/minh" }] }] }), indexed: true };
    api.readShowcase.mockResolvedValue({ profile: { ...p, headline: "" }, stats: { as_of: "2026-10-22", summary: null, calendar: null, milestones: null, outcomes: null } });
    const res = await publicPage.loader({ request: new Request("http://localhost/u/minh?lang=vi"), params: { handle: "minh" }, context: {} } as never);
    expect((res.init?.headers as Record<string, string>)["X-Robots-Tag"]).toBeUndefined();
    const tags = publicPage.meta({ data: res.data } as never) as Record<string, unknown>[];
    expect(tags.some((t) => t.name === "robots")).toBe(false);
    expect(tags).toContainEqual({ tagName: "link", rel: "canonical", href: "https://anytools.world/u/minh?lang=vi" });
    expect(tags).toContainEqual({ tagName: "link", rel: "alternate", hrefLang: "es", href: "https://anytools.world/u/minh?lang=es" });
    expect(tags).toContainEqual({ tagName: "link", rel: "alternate", hrefLang: "x-default", href: "https://anytools.world/u/minh" });
    const ld = tags.find((t) => "script:ld+json" in t)?.["script:ld+json"] as Record<string, Record<string, unknown>>;
    expect(ld["@type"]).toBe("ProfilePage");
    expect(ld.mainEntity).toMatchObject({ "@type": "Person", name: "Minh", alternateName: "@minh", sameAs: ["https://github.com/minh"] });
    // No headline: a line of the site's own, in the page's language.
    expect(tags).toContainEqual({ name: "description", content: expect.stringContaining("Hồ sơ học tập của Minh") });
  });

  it("puts indexed pages in the sitemap, one entry each naming every language", async () => {
    const [entry] = showcaseUrls([{ handle: "minh", updated_at: "2026-10-21T08:00:00Z" }]);
    expect(entry).toContain("<loc>https://anytools.world/u/minh</loc>");
    expect(entry).toContain("<lastmod>2026-10-21</lastmod>");
    expect(entry).toContain('hreflang="pt" href="https://anytools.world/u/minh?lang=pt"');
    expect(entry).toContain('hreflang="x-default" href="https://anytools.world/u/minh"');
  });

  it("draws a share card with numbers only when the page shows them", async () => {
    card.mockResolvedValue(new Uint8Array([1]));
    api.readShowcase.mockResolvedValue({ profile: profile(), stats });
    const res = (await og.loader({ request: new Request("http://localhost/u/minh/og.png?lang=en"), params: { handle: "minh" }, context: {} } as never)) as Response;
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(card).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Minh", accent: "ask", address: "anytools.world/u/minh" }));
    expect((card.mock.lastCall![0] as { stats: unknown[] }).stats).toHaveLength(3);

    api.readShowcase.mockResolvedValue({ profile: profile({ blocks: [{ type: "calendar" }] }), stats: { ...stats, summary: null } });
    await og.loader({ request: new Request("http://localhost/u/minh/og.png?lang=en"), params: { handle: "minh" }, context: {} } as never);
    expect((card.mock.lastCall![0] as { stats: unknown[] }).stats).toEqual([]);

    // The card's language is its address's alone, so one address is one picture.
    api.readShowcase.mockResolvedValue({ profile: profile({ headline: "x" } as never), stats });
    await og.loader({
      request: new Request("http://localhost/u/minh/og.png", { headers: { "Accept-Language": "vi", Cookie: "anylearn-lang=es" } }),
      params: { handle: "minh" },
      context: {},
    } as never);
    expect((card.mock.lastCall![0] as { tab: string }).tab).toBe("Learning profile");
  });
});
