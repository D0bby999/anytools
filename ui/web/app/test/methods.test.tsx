/**
 * methods.test.tsx
 * The learning-methods guide (the private design notes): every
 * method has words in four languages, evidence, studies with DOIs, links
 * to real pages and English videos; videos play only when asked, in the
 * privacy-enhanced player; "Add to my knowledge" takes only listed videos.
 */
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";

vi.mock("~/lib/env.server", () => ({ API_BASE: "http://api.internal:8080", API_TOKEN: "t", isProduction: false }));
const requireUser = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireUser: (r: Request) => requireUser(r) }));
const kb = { listKBs: vi.fn(), createKB: vi.fn(), addLink: vi.fn() };
vi.mock("~/lib/kb.server", () => kb);
const { ApiError } = await import("~/lib/api.server");
const lib = await import("~/lib/methods");
const index = await import("~/routes/methods");
const detail = await import("~/routes/methods.$slug");
const videoData = JSON.parse(readFileSync("app/data/methods/videos.json", "utf8")) as { videos: { id: string; lang: string; methods: string[]; title: string }[] };
const routes = readFileSync("app/routes.ts", "utf8");

const form = (fields: Record<string, string>) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return new Request("http://localhost/methods", { method: "POST", body });
};
const show = (element: React.ReactNode) =>
  render(<RouterProvider router={createMemoryRouter([{ path: "/", element, action: () => null }])} />);

beforeAll(() => initI18n("en"));
beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ userId: "u1", user: { id: "u1", language: "vi" } });
});

describe("the methods' data", () => {
  it("gives every method words in four languages, studies, real pages and an English video", () => {
    const placeholders = (s: string) => [...s.matchAll(/{{(\w+)/g)].map((m) => m[1]).sort();
    const en = JSON.parse(readFileSync("public/locales/en/methods.json", "utf8"));
    for (const lang of ["vi", "es", "pt"]) {
      const words = JSON.parse(readFileSync(`public/locales/${lang}/methods.json`, "utf8"));
      expect(Object.keys(words.methods).sort()).toEqual([...lib.METHOD_SLUGS].sort());
      for (const m of lib.METHOD_SLUGS) expect(words.methods[m].steps.length, `${lang} ${m}`).toBe(en.methods[m].steps.length);
      for (const key of ["play", "meta", "saved", "failed", "checked"]) {
        expect(placeholders(words.videos[key]), `${lang} videos.${key}`).toEqual(placeholders(en.videos[key]));
      }
    }
    for (const m of lib.METHOD_SLUGS) {
      expect(lib.SOURCES[m].length, m).toBeGreaterThan(0);
      for (const s of lib.SOURCES[m]) expect(s.doi, m).toMatch(/^10\.\d{4,5}\/\S+$/);
      // Settings' pages are nested routes, as in nav-tree.test.ts.
      for (const d of lib.DO_IT[m]) expect(routes, `${m} → ${d.to}`).toContain(`"${d.to.replace(/^\/settings\//, "").slice(d.to.startsWith("/settings/") ? 0 : 1)}"`);
      expect(lib.videosFor(m, "en").length, m).toBeGreaterThan(0);
    }
    expect(lib.videosFor("overview", "en").length).toBeGreaterThan(0);
  });

  it("lists each video once, for known methods, in one of the four languages", () => {
    const ids = videoData.videos.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const v of videoData.videos) {
      expect(["en", "vi", "es", "pt"], v.id).toContain(v.lang);
      for (const m of v.methods) expect([...lib.METHOD_SLUGS, "overview"], v.id).toContain(m);
      expect(v.id).toMatch(/^[\w-]{11}$/);
    }
  });

  it("puts the learner's language first, then English, and no third language", () => {
    for (const ui of ["vi", "es", "pt"]) {
      const langs = lib.videosFor("retrieval", ui).map((v) => v.lang);
      expect(langs[0], ui).toBe(ui);
      expect(new Set(langs), ui).toEqual(new Set([ui, "en"]));
    }
    expect(new Set(lib.videosFor("retrieval", "en").map((v) => v.lang))).toEqual(new Set(["en"]));
    expect(lib.playerURL("abc-DEF_123")).toBe("https://www.youtube-nocookie.com/embed/abc-DEF_123?autoplay=1&rel=0");
  });
});

describe("the pages", () => {
  it("groups the methods by evidence, with the three that matter most first", async () => {
    await index.loader({ request: new Request("http://localhost/methods"), params: {}, context: {} } as never);
    expect(requireUser).toHaveBeenCalled();
    show(<index.default />);
    expect(await screen.findByRole("heading", { name: "If you do only three things" })).toBeTruthy();
    const strong = screen.getByRole("heading", { name: "Strong evidence" }).closest("section")!;
    expect(strong.textContent).toContain("Test yourself (retrieval practice)");
    expect(screen.getByRole("link", { name: "Myths: learning styles, rereading and highlighting" }).getAttribute("href")).toBe("/methods/myths");
  });

  it("shows a method, and loads YouTube's player only when asked", async () => {
    const data = await detail.loader({ request: new Request("http://localhost/methods/retrieval"), params: { slug: "retrieval" }, context: {} } as never);
    const { container } = show(<detail.default loaderData={data} actionData={undefined} params={{ slug: "retrieval" }} matches={[] as never} />);
    expect(await screen.findByText("Strong evidence")).toBeTruthy();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThan(4);
    expect(screen.getByRole("link", { name: "Practice questions" }).getAttribute("href")).toBe("/quiz/practice");
    expect(screen.getByRole("link", { name: "doi:10.1111/j.1467-9280.2006.01693.x (opens in a new tab)" }).getAttribute("href")).toBe("https://doi.org/10.1111/j.1467-9280.2006.01693.x");
    expect(container.querySelector("iframe")).toBeNull();
    // The page is in English here, so the English videos come first.
    const first = lib.videosFor("retrieval", "en")[0]!;
    await userEvent.click(screen.getByRole("button", { name: `Play: ${first.title}` }));
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(lib.playerURL(first.id));
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-presentation allow-popups");
    expect(document.activeElement).toBe(frame);
    const search = screen.getByRole("link", { name: "Search YouTube for more (opens in a new tab)" }).getAttribute("href")!;
    expect(search).toContain("https://www.youtube.com/results?search_query=");
  });

  it("answers 404 for a method it does not have", async () => {
    await expect(detail.loader({ request: new Request("http://localhost/methods/x"), params: { slug: "x" }, context: {} } as never)).rejects.toMatchObject({
      init: { status: 404 },
    });
  });
});

describe("Add to my knowledge", () => {
  it("adds a listed video to the guide's knowledge base, named by the server and made the first time", async () => {
    kb.listKBs.mockResolvedValue({ knowledge_bases: [{ kb: { id: "k0", name: "Other" } }] });
    kb.createKB.mockResolvedValue({ id: "k1", name: "Phương pháp học" });
    kb.addLink.mockResolvedValue({ document: {} });
    const res = await index.action({ request: form({ video: "Pjrqc6UMDKM", kbName: "Anything" }), params: {}, context: {} } as never);
    expect(res).toEqual({ video: "Pjrqc6UMDKM", kbId: "k1", kbName: "Phương pháp học" });
    expect(kb.createKB).toHaveBeenCalledWith("u1", "Phương pháp học");
    expect(kb.addLink).toHaveBeenCalledWith("u1", "k1", "https://www.youtube.com/watch?v=Pjrqc6UMDKM", false);

    // In English now, the Vietnamese-named one is still the guide's.
    requireUser.mockResolvedValue({ userId: "u1", user: { id: "u1", language: "en" } });
    kb.listKBs.mockResolvedValue({ knowledge_bases: [{ kb: { id: "k1", name: "Phương pháp học" } }] });
    await detail.action({ request: form({ video: "3WJYp98eys8" }), params: { slug: "spacing" }, context: {} } as never);
    expect(kb.createKB).toHaveBeenCalledTimes(1);
    expect(kb.addLink).toHaveBeenLastCalledWith("u1", "k1", "https://www.youtube.com/watch?v=3WJYp98eys8", false);
  });

  it("refuses a video the guide does not list, and reports what the API refused", async () => {
    expect(await index.action({ request: form({ video: "dQw4w9WgXcQ" }), params: {}, context: {} } as never)).toEqual({ video: "dQw4w9WgXcQ", error: "not_listed" });
    expect(kb.addLink).not.toHaveBeenCalled();
    kb.listKBs.mockResolvedValue({ knowledge_bases: [{ kb: { id: "k1", name: "Learning methods" } }] });
    kb.addLink.mockRejectedValue(new ApiError(429, "too many requests", "rate_limited"));
    expect(await index.action({ request: form({ video: "Pjrqc6UMDKM" }), params: {}, context: {} } as never)).toEqual({
      video: "Pjrqc6UMDKM",
      error: "too many requests",
    });
  });
});
