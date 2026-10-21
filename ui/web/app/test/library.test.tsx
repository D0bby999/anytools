/**
 * library.test.tsx
 * The Library (the private design notes, phase 1): the
 * catalogue's invariants, its filter, the page's actions, and the page by
 * keyboard.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { initI18n } from "~/lib/i18n";

vi.mock("~/lib/env.server", () => ({ API_BASE: "http://api.internal:8080", API_TOKEN: "t", isProduction: false }));
const requireUser = vi.fn();
vi.mock("~/lib/auth.server", () => ({ requireUser: (r: Request) => requireUser(r) }));
const kb = { listKBs: vi.fn(), createKB: vi.fn(), addLink: vi.fn() };
vi.mock("~/lib/kb.server", () => kb);
const decks = { addLibraryDeck: vi.fn() };
vi.mock("~/lib/decks.server", () => decks);
const vocab = { importWords: vi.fn(), studiedLanguages: vi.fn(), setStudiedLanguages: vi.fn() };
vi.mock("~/lib/vocab.server", () => vocab);
const quiz = { addQuestionSet: vi.fn() };
vi.mock("~/lib/quiz.server", () => quiz);

const { catalogue, findItems } = await import("~/lib/library/catalogue.server");
const { LIBRARY_KINDS, LIBRARY_SUBJECTS } = await import("~/lib/library/types");
const route = await import("~/routes/library");

beforeAll(() => initI18n("en"));
beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ userId: "user-1", user: { id: "user-1", language: "vi" } });
  kb.listKBs.mockResolvedValue({ knowledge_bases: [{ kb: { id: "kb-1", name: "Physics" } }] });
});

const post = (fields: Record<string, string>) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return route.action({ request: new Request("http://localhost/library", { method: "POST", body }), params: {}, context: {} } as never);
};

describe("the catalogue", () => {
  it("gives every item a kind, subject, licence and https source", () => {
    const { items } = catalogue();
    expect(items.length).toBeGreaterThan(10);
    for (const i of items) {
      expect(LIBRARY_KINDS).toContain(i.kind);
      expect(LIBRARY_SUBJECTS).toContain(i.subject);
      expect(i.licence).toBeTruthy();
      expect(i.source.url).toMatch(/^https:\/\//);
      expect(i.url).toMatch(/^(https:\/\/|\/)/);
      if (i.action.type === "deck") expect(i.licence).not.toMatch(/nc|none/);
    }
  });

  it("links free-programming-books' courses and books, each once, with its credit", () => {
    const fpb = catalogue().items.filter((i) => i.source.name === "free-programming-books");
    expect(fpb.length).toBeGreaterThan(4000);
    for (const i of fpb) {
      expect(i.action).toEqual({ type: "link", url: i.url });
      expect(i.url).toMatch(/^https:\/\//);
      expect(i.credit).toBe("credits.fpb");
    }
    const vi = findItems({ kind: "course", lang: "vi", q: "", offset: 0 }, "vi");
    expect(vi.total).toBeGreaterThan(300);
    expect(findItems({ kind: "course", lang: "vi", q: "lap trinh android", offset: 0 }, "vi").total).toBeGreaterThan(3);
  });

  it("lists what may not be copied without an add action", () => {
    const nc = catalogue().items.filter((i) => i.licence === "cc-by-nc" || i.licence === "cc-by-nc-sa");
    expect(nc.length).toBeGreaterThan(0);
    for (const i of nc) expect(i.action.type).toBe("open");
  });

  it("filters by kind, subject, language and words without accents", () => {
    const mine = findItems({ lang: "", q: "", offset: 0 }, "vi");
    expect(mine.items.every((i) => ["vi", "en", "mul"].includes(i.language.split("-")[0]!))).toBe(true);
    const all = findItems({ lang: "all", q: "", offset: 0 }, "vi");
    expect(all.total).toBeGreaterThan(mine.total);
    const geo = findItems({ kind: "deck", subject: "geography", lang: "es", q: "", offset: 0 }, "en");
    expect(geo.total).toBe(3);
    expect(findItems({ lang: "all", q: "de thi tot nghiep", offset: 0 }, "en").items.map((i) => i.id)).toEqual(["thpt-papers"]);
  });
});

describe("the exam word lists", () => {
  it("has each level's words once, each with a meaning, under an origin the API takes", async () => {
    const { WORD_LISTS } = await import("~/lib/library/word-lists");
    expect(WORD_LISTS.map((l) => l.list).sort()).toEqual(["hsk2", "hsk3", "jlpt", "nawl", "ngsl"]);
    for (const list of WORD_LISTS) {
      const data = (await import(`~/data/library/words/${list.list}.json`)).default as { levels: { id: string; notes: { t: string; m: string }[] }[] };
      expect(data.levels.map((l) => l.id)).toEqual(list.levels.map((l) => l.id));
      for (const level of data.levels) {
        expect(`library:${level.id}`).toMatch(/^library:[a-z0-9][a-z0-9-]{0,47}$/);
        expect(new Set(level.notes.map((n) => n.t)).size).toBe(level.notes.length);
        expect(level.notes.every((n) => n.t && n.m && n.t.length <= 80 && n.m.length <= 1000)).toBe(true);
      }
    }
  });

  it("adds a level in batches of 200, with its origin, and puts the language on the list", async () => {
    vocab.importWords.mockResolvedValue({ created: 200, duplicates: 0, invalid: 0, first_day: "2026-10-22" });
    vocab.studiedLanguages.mockResolvedValue({ studied: ["en"], current: "en", saved: [] });
    const res = await post({ intent: "add-words", id: "words:hsk3", level: "hsk3-1" });
    expect(vocab.importWords).toHaveBeenCalledTimes(3);
    expect(vocab.importWords.mock.calls[0]).toEqual(["user-1", "zh", expect.any(Array), "library:hsk3-1"]);
    expect(vocab.importWords.mock.calls[0]![2][0]).toEqual({ term: "的", meaning: expect.stringMatching(/^de · /), sentence: "" });
    expect(vocab.setStudiedLanguages).toHaveBeenCalledWith("user-1", ["en", "zh"], "zh");
    expect(res).toMatchObject({ words: { created: 600, language: "zh" } });
    const { wordListOf } = await import("~/lib/library/word-lists");
    expect(wordListOf("library:hsk3-1")).toMatchObject({ list: { name: "HSK 3.0" }, level: { name: "1" } });
    expect(wordListOf("anki")).toBeNull();
    // A level the list does not have is refused.
    expect(await post({ intent: "add-words", id: "words:hsk3", level: "jlpt-n5" })).toMatchObject({ errorKey: "library:errors.failed" });
  });
});

describe("the question sets", () => {
  it("lists each set with its parts, and adds a part to a knowledge base", async () => {
    const sets = catalogue().items.filter((i) => i.kind === "questions" && i.action.type === "set");
    expect(sets.map((s) => s.id).sort()).toEqual(["set:arc", "set:gsm8k", "set:python", "set:trivia"]);
    for (const s of sets) expect(s.action.type === "set" && s.action.parts.every((p) => p.count > 0 && p.count <= 100)).toBe(true);
    quiz.addQuestionSet.mockResolvedValue({ added: 100, already: 0 });
    expect(await post({ intent: "add-set", id: "set:gsm8k", part: "p-1", kb: "kb-1" })).toMatchObject({ set: { added: 100, kbId: "kb-1" } });
    expect(quiz.addQuestionSet).toHaveBeenCalledWith("user-1", "kb-1", "gsm8k", "p-1");
    expect(await post({ intent: "add-set", id: "set:gsm8k", part: "nope", kb: "kb-1" })).toMatchObject({ errorKey: "library:errors.failed" });
    expect(quiz.addQuestionSet).toHaveBeenCalledTimes(1);
  });
});

describe("the page's actions", () => {
  it("adds a bundled deck", async () => {
    decks.addLibraryDeck.mockResolvedValue({ deck: { name: "Ultimate Geography (EN)" }, totals: { created: 436, duplicates: 0, invalid: 0 } });
    const res = await post({ intent: "add-deck", id: "deck:ultimate-geography-en" });
    expect(decks.addLibraryDeck).toHaveBeenCalledWith("user-1", "ultimate-geography-en");
    expect(res).toMatchObject({ deck: { created: 436 } });
  });

  it("refuses an add the item does not have, and an unknown item", async () => {
    expect(await post({ intent: "add-deck", id: "mit-ocw" })).toMatchObject({ errorKey: "library:errors.failed" });
    expect(decks.addLibraryDeck).not.toHaveBeenCalled();
    await expect(post({ intent: "add-deck", id: "nope" })).rejects.toMatchObject({ init: { status: 404 } });
  });

  it("adds a course to a knowledge base, or to a new one named after it", async () => {
    const course = catalogue().items.find((i) => i.video && i.language === "vi")!;
    kb.addLink.mockResolvedValue({ feed: { id: "f" } });
    expect(await post({ intent: "add-link", id: course.id, kb: "kb-1" })).toMatchObject({ link: { kbId: "kb-1", kbName: "Physics", feed: true } });
    expect(kb.addLink).toHaveBeenCalledWith("user-1", "kb-1", course.url, false);
    kb.createKB.mockResolvedValue({ id: "kb-2", name: course.name });
    kb.addLink.mockResolvedValue({ document: { id: "d" } });
    expect(await post({ intent: "add-link", id: course.id, kb: "new" })).toMatchObject({ link: { kbId: "kb-2", feed: false } });
    expect(kb.createKB).toHaveBeenCalledWith("user-1", course.name);
    // Someone else's knowledge base is not in the learner's list: refused.
    expect(await post({ intent: "add-link", id: course.id, kb: "kb-other" })).toMatchObject({ errorKey: "library:errors.chooseKB" });
  });

  it("loads knowledge bases only when the page has something to add to one", async () => {
    const res = await route.loader({ request: new Request("http://localhost/library?kind=deck"), params: {}, context: {} } as never);
    expect(kb.listKBs).not.toHaveBeenCalled();
    expect(res.kbs).toEqual([]);
  });
});

describe("the page", () => {
  it("filters by keyboard and says each item's licence and source", async () => {
    const data = await route.loader({ request: new Request("http://localhost/library?lang=all"), params: {}, context: {} } as never);
    const router = createMemoryRouter(
      [{ path: "/library", element: <route.default loaderData={data as never} params={{}} matches={[] as never} />, action: () => null }],
      { initialEntries: ["/library?lang=all"] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByRole("heading", { level: 1, name: "Library" })).toBeInTheDocument();
    const ocw = screen.getByRole("link", { name: /MIT OpenCourseWare/ }).closest("li")!;
    expect(within(ocw).getByText(/Non-commercial use only/)).toBeInTheDocument();
    expect(within(ocw).getByText(/open it at the source/)).toBeInTheDocument();
    expect(within(ocw).queryByRole("button")).toBeNull();
    const geo = screen.getByRole("button", { name: "Add Ultimate Geography (Spanish) to Decks" });
    expect(geo).toBeInTheDocument();
    await userEvent.tab();
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveFocus();
  });
});

describe("free-programming-books' lists", async () => {
  // @ts-expect-error: a build script, plain JavaScript.
  const { parseList, subjectOf } = await import("../../scripts/library/free-programming-books.mjs");
  it("reads sections, subsections, authors and notes, and skips the index", () => {
    const md = [
      "### Index",
      "* [Android](#android)",
      "### <a id=\"csharp\"></a>C\\#",
      "* [C# cơ bản](https://www.youtube.com/playlist?list=PL1) - Kteam",
      "#### ASP.NET",
      "  * [Web API](https://example.org/a_(b)) - Jane *Doe* (PDF) (email address *requested*)",
      "* [Bare](https://example.org/bare)",
      "* not a link",
    ].join("\n");
    expect(parseList(md)).toEqual([
      { title: "C# cơ bản", url: "https://www.youtube.com/playlist?list=PL1", author: "Kteam", notes: [], section: "C#" },
      { title: "Web API", url: "https://example.org/a_(b)", author: "Jane Doe", notes: ["PDF", "email address requested"], section: "C# › ASP.NET" },
      { title: "Bare", url: "https://example.org/bare", author: "", notes: [], section: "C# › ASP.NET" },
    ]);
  });

  it("files a section under its subject in any of the four languages", () => {
    expect(subjectOf("Mathematics")).toBe("maths");
    expect(subjectOf("Toán học")).toBe("maths");
    expect(subjectOf("0 - MOOC")).toBe("general");
    expect(subjectOf("Python")).toBe("programming");
  });
});
