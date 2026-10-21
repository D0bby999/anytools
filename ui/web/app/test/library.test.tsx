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

const { catalogue, findByField, findItems, FIELD_SAMPLE } = await import("~/lib/library/catalogue.server");
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

  it("puts English material first, whatever else is shown", () => {
    for (const lang of ["", "all"]) {
      const { items } = findItems({ kind: "course", lang, q: "", offset: 0 }, "vi");
      expect(items.every((i) => i.language === "en" || i.language === "mul")).toBe(true);
    }
    // Across the whole list: every English item, then the many-language ones, then the rest.
    const all = findItems({ lang: "all", q: "", offset: 0 }, "vi").total;
    const en = findItems({ lang: "en", q: "", offset: 0 }, "vi").total;
    const mul = catalogue().items.filter((i) => i.language === "mul").length;
    const rank = (offset: number) => findItems({ lang: "all", q: "", offset }, "vi").items.map((i) => (i.language === "en" ? 0 : i.language === "mul" ? 1 : 2));
    expect(rank(en - mul - 1)[0]).toBe(0);
    expect(rank(en - mul)[0]).toBe(1);
    expect(rank(en)[0]).toBe(2);
    expect(rank(all - 30).every((r) => r === 2)).toBe(true);
  });

  it("filters by kind, subject, language and words without accents", () => {
    const mine = findItems({ lang: "", q: "", offset: 0 }, "vi");
    expect(mine.items.every((i) => ["vi", "en", "mul"].includes(i.language.split("-")[0]!))).toBe(true);
    const all = findItems({ lang: "all", q: "", offset: 0 }, "vi");
    expect(all.total).toBeGreaterThan(mine.total);
    const geo = findItems({ kind: "deck", subject: "general", lang: "es", q: "", offset: 0 }, "en");
    expect(geo.total).toBe(3);
    expect(findItems({ lang: "all", q: "de thi tot nghiep", offset: 0 }, "en").items.map((i) => i.id)).toEqual(["thpt-papers"]);
  });
});

describe("the fields", () => {
  it("has English material in every field, a few of each on the first screen", () => {
    const { total, groups } = findByField({ lang: "", q: "", offset: 0 }, "en");
    expect(groups.map((g) => g.subject)).toEqual([...LIBRARY_SUBJECTS]);
    expect(groups.reduce((n, g) => n + g.total, 0)).toBe(total);
    for (const g of groups) {
      expect(g.items.length).toBe(Math.min(FIELD_SAMPLE, g.total));
      expect(g.items.every((i) => i.subject === g.subject && i.language === "en")).toBe(true);
    }
    // Professions, not only programming: each of these has hundreds.
    const count = Object.fromEntries(groups.map((g) => [g.subject, g.total]));
    for (const field of ["business", "law", "health", "engineering", "social", "humanities", "education"]) expect(count[field]).toBeGreaterThan(80);
  });

  it("lets the sources take turns, so one source does not fill a page", () => {
    const { items } = findItems({ subject: "programming", lang: "", q: "", offset: 0 }, "en");
    expect(new Set(items.slice(0, 10).map((i) => i.source.name)).size).toBeGreaterThan(4);
    const first = findByField({ kind: "course", lang: "", q: "", offset: 0 }, "en").groups.find((g) => g.subject === "programming")!;
    expect(new Set(first.items.map((i) => i.source.name)).size).toBe(FIELD_SAMPLE);
  });

  it("shows the first screen by field, and a field or a search as one list", async () => {
    const first = await route.loader({ request: new Request("http://localhost/library"), params: {}, context: {} } as never);
    expect(first.groups.length).toBe(LIBRARY_SUBJECTS.length);
    expect(first.items).toEqual([]);
    const field = await route.loader({ request: new Request("http://localhost/library?subject=law"), params: {}, context: {} } as never);
    expect(field.groups).toEqual([]);
    expect(field.items.length).toBe(30);
    expect(field.items.every((i) => i.subject === "law")).toBe(true);
    const search = await route.loader({ request: new Request("http://localhost/library?q=nursing"), params: {}, context: {} } as never);
    expect(search.groups).toEqual([]);
    expect(search.total).toBeGreaterThan(5);
    // Spaces alone are no search.
    const blank = await route.loader({ request: new Request("http://localhost/library?q=%20%20"), params: {}, context: {} } as never);
    expect(blank.groups.length).toBe(LIBRARY_SUBJECTS.length);
  });

  it("builds a first screen once, and shows each field's featured items first", () => {
    const a = findByField({ lang: "", q: "", offset: 0 }, "en");
    expect(findByField({ lang: "", q: "", offset: 0 }, "en")).toBe(a);
    // MIT's courses with lecture videos first; the Open Textbook Library's reusable books with a PDF first.
    const mit = findItems({ subject: "engineering", lang: "", q: "", offset: 0 }, "en").items.find((i) => i.source.name === "MIT OpenCourseWare")!;
    expect(mit.video).toBe(true);
    const otl = findItems({ subject: "law", lang: "", q: "", offset: 0 }, "en").items.find((i) => i.source.name === "Open Textbook Library")!;
    expect(otl.licence).toMatch(/^(cc-by|cc-by-sa|cc0|gfdl)$/);
    expect(otl.action).toMatchObject({ pdf: expect.stringMatching(/\.pdf$/i) });
    // Sites listed on their own are not listed again from the awesome lists.
    expect(catalogue().items.filter((i) => i.id.startsWith("awesome-") && /khanacademy\.org|ocw\.mit\.edu|openstax\.org/.test(i.url))).toEqual([]);
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
        // One tap adds at most 50 days of new words at 20 a day.
        expect(level.notes.length).toBeLessThanOrEqual(1000);
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

describe("the textbooks", () => {
  it("lists OpenStax's live books with their own licences, opened at their page", () => {
    const books = catalogue().items.filter((i) => i.source.name === "OpenStax");
    expect(books.length).toBeGreaterThan(80);
    for (const b of books) {
      expect(b.url).toMatch(/^https:\/\/openstax\.org\/details\/books\//);
      expect(b.action).toMatchObject({ type: "open", why: b.licence.includes("nc") ? "textbookNonCommercial" : "textbook" });
    }
    expect(new Set(books.map((b) => b.licence))).toEqual(new Set(["cc-by", "cc-by-nc-sa", "none"]));
    expect(findItems({ kind: "textbook", subject: "maths", lang: "es", q: "", offset: 0 }, "en").total).toBeGreaterThan(3);
  });

  it("lists the Open Textbook Library's books in every field, each with its licence, none of OpenStax's twice", () => {
    const books = catalogue().items.filter((i) => i.source.name === "Open Textbook Library");
    expect(books.filter((b) => b.language === "en").length).toBeGreaterThan(1600);
    expect(new Set(books.map((b) => b.subject)).size).toBeGreaterThanOrEqual(14);
    for (const b of books) {
      expect(b).toMatchObject({ kind: "textbook", credit: "credits.otl" });
      expect(b.url).toMatch(/^https:\/\/open\.umn\.edu\/opentextbooks\/textbooks\//);
      expect(b.action).toMatchObject({ type: "open", why: b.licence.includes("nc") ? "textbookNonCommercial" : "textbook" });
      if (b.action.type === "open" && b.action.pdf) expect(b.action.pdf).toMatch(/^https:\/\/[^?#]+\.pdf$/i);
    }
    expect(new Set(books.map((b) => b.licence))).toEqual(new Set(["cc-by", "cc-by-sa", "cc0", "gfdl", "cc-by-nd", "cc-by-nc", "cc-by-nc-sa", "cc-by-nc-nd"]));
  });
});

describe("MIT OpenCourseWare", () => {
  it("lists every course by department, opened at MIT as its licence asks", () => {
    const courses = catalogue().items.filter((i) => i.source.name === "MIT OpenCourseWare");
    expect(courses.length).toBeGreaterThan(2500);
    expect(new Set(courses.map((c) => c.subject)).size).toBeGreaterThanOrEqual(12);
    expect(courses.filter((c) => c.video).length).toBeGreaterThan(300);
    for (const c of courses) {
      expect(c).toMatchObject({ kind: "course", language: "en", licence: "cc-by-nc-sa", credit: "credits.mit", action: { type: "open", why: "nonCommercial" } });
      expect(c.url).toMatch(/^https:\/\/ocw\.mit\.edu\/courses\//);
    }
  });
});

describe("the lists from sindresorhus/awesome", () => {
  it("adds their links through the link import, each list credited", () => {
    const items = catalogue().items.filter((i) => i.id.startsWith("awesome-"));
    const by = (list: string) => items.filter((i) => i.id.startsWith(`awesome-${list}:`));
    expect(by("math").length).toBeGreaterThan(250);
    expect(by("certificates").length).toBeGreaterThan(150);
    expect(by("youtubers").length).toBeGreaterThan(200);
    for (const i of items) {
      expect(i.action).toEqual({ type: "link", url: i.url });
      expect(i.credit).toMatch(/^credits\.awesome\.(math|certificates|youtubers)$/);
      expect(i.licence).toBe("free-access");
    }
    expect(by("youtubers").every((i) => i.video && /youtube\.com\//.test(i.url))).toBe(true);
    expect(by("certificates").some((i) => i.unit === "hours" && i.count! > 0)).toBe(true);
  });
});

describe("Project Gutenberg's books", () => {
  it("adds a public-domain book from its HTML edition, credited", async () => {
    const books = catalogue().items.filter((i) => i.source.name === "Project Gutenberg");
    expect(books.length).toBeGreaterThan(1000);
    const pride = books.find((b) => b.id === "gutenberg:1342")!;
    expect(pride).toMatchObject({ kind: "book", language: "en", licence: "public-domain", credit: "credits.gutenberg", author: "Austen, Jane" });
    expect(pride.action).toEqual({ type: "link", url: "https://www.gutenberg.org/cache/epub/1342/pg1342-images.html" });
    expect(books.every((b) => !/&#?\w+;/.test(b.name))).toBe(true);
    expect(findItems({ kind: "book", lang: "es", q: "", offset: 0 }, "en").total).toBeGreaterThanOrEqual(100);
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
    expect(await post({ intent: "add-deck", id: "khan-academy" })).toMatchObject({ errorKey: "library:errors.failed" });
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
    // The first screen is by field, each with a link to all of it.
    expect(screen.getByRole("heading", { level: 2, name: "Law" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^See all [\d,]+ in Medicine and health$/ })).toHaveAttribute("href", "/library?subject=health&lang=all");
    const ocw = screen.getAllByRole("link", { name: "Source: MIT OpenCourseWare" })[0]!.closest("li")!;
    expect(within(ocw).getByText(/Non-commercial use only/)).toBeInTheDocument();
    expect(within(ocw).getByText(/open it at the source/)).toBeInTheDocument();
    expect(within(ocw).queryByRole("button")).toBeNull();
    const geo = screen.getByRole("button", { name: "Add to Decks: Ultimate Geography (English)" });
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
    expect(subjectOf("Professional Development")).toBe("skills");
    expect(subjectOf("Digital Electronics")).toBe("engineering");
  });
});

describe("Gutenberg's catalogue dump", async () => {
  // @ts-expect-error: a build script, plain JavaScript.
  const { bookOf, subjectOf } = await import("../../scripts/library/gutenberg.mjs");
  const rdf = (extra: string) => `<pgterms:ebook rdf:about="ebooks/1342">
    <dcterms:rights>Public domain in the USA.</dcterms:rights>
    <pgterms:downloads rdf:datatype="x">190246</pgterms:downloads>
    <dcterms:creator><pgterms:agent rdf:about="2010/agents/68"><pgterms:name>Austen, Jane</pgterms:name></pgterms:agent></dcterms:creator>
    <dcterms:title>Pride and Prejudice&#13; A Novel</dcterms:title>
    <dcterms:language><rdf:Description><rdf:value rdf:datatype="x">en</rdf:value></rdf:Description></dcterms:language>
    <dcterms:type><rdf:Description><rdf:value>Text</rdf:value></rdf:Description></dcterms:type>
    <pgterms:bookshelf><rdf:Description><rdf:value>Category: Novels</rdf:value></rdf:Description></pgterms:bookshelf>
    <pgterms:file rdf:about="https://www.gutenberg.org/ebooks/1342.html.images"><dcterms:extent rdf:datatype="x">${extra}</dcterms:extent></pgterms:file>
  </pgterms:ebook>`;
  it("keeps a public-domain text whose HTML the link import can read", () => {
    expect(bookOf(rdf("852590"))).toEqual({ id: 1342, title: "Pride and Prejudice A Novel", author: "Austen, Jane", language: "en", subject: "humanities", shelves: ["Novels"], downloads: 190246 });
    expect(bookOf(rdf(String(6 << 20)))).toBeNull();
    expect(bookOf(rdf("852590").replace("Public domain in the USA.", "Copyrighted."))).toBeNull();
  });
  it("files science fiction as a novel", () => {
    expect(subjectOf(["Category: Science-Fiction & Fantasy"])).toBe("humanities");
    expect(subjectOf(["Category: Science - Physics"])).toBe("science");
  });
  it("files a book by its first field-specific shelf", () => {
    expect(subjectOf(["Category: Novels", "Category: Economics"])).toBe("economics");
    expect(subjectOf(["Category: Psychiatry/Psychology"])).toBe("social");
    expect(subjectOf(["Category: Health & Medicine", "Category: Science - Biology"])).toBe("health");
  });
});

describe("the Open Textbook Library's catalogue", async () => {
  // @ts-expect-error: a build script, plain JavaScript.
  const { bookOf, fieldOf } = await import("../../scripts/library/open-textbooks.mjs");
  const book = (extra: object) => ({
    id: 4,
    title: " Financial Accounting ",
    language: "eng",
    license: "Attribution",
    url: "https://open.umn.edu/opentextbooks/textbooks/financial-accounting",
    contributors: [{ contribution: "Author", first_name: "Ann", middle_name: "B.", last_name: "Cole" }, { contribution: "Illustrator", first_name: "X", last_name: "Y" }],
    subjects: [{ name: "Accounting", parent_subject_id: 2 }, { name: "Business", parent_subject_id: null }],
    formats: [{ type: "PDF", url: "https://example.edu/download" }, { type: "PDF", url: "https://example.edu/book.pdf" }],
    ...extra,
  });
  it("keeps a book's field, licence, authors and a PDF link only where it is one", () => {
    expect(bookOf(book({}))).toEqual({
      id: 4,
      title: "Financial Accounting",
      author: "Ann B. Cole",
      language: "en",
      subject: "economics",
      section: "Accounting",
      licence: "cc-by",
      url: "https://open.umn.edu/opentextbooks/textbooks/financial-accounting",
      pdf: "https://example.edu/book.pdf",
    });
    expect(bookOf(book({ formats: [{ type: "Online", url: "https://openstax.org/details/books/x" }] }))).toBeNull();
    expect(bookOf(book({ license: "Something else" }))).toBeNull();
    expect(bookOf(book({ language: "xxx" }))).toBeNull();
  });
  it("files a book that names only a child subject under its parent's field", () => {
    expect(fieldOf([{ name: "Biology", parent_subject_id: 8 }])).toEqual({ subject: "science", section: "Biology" });
    expect(fieldOf([{ name: "Nursing", parent_subject_id: 17 }, { name: "Medicine", parent_subject_id: null }])).toEqual({ subject: "health", section: "Nursing" });
    expect(fieldOf([])).toEqual({ subject: "general", section: "" });
  });
});

describe("MIT OpenCourseWare's catalogue", async () => {
  // @ts-expect-error: a build script, plain JavaScript.
  const { courseOf, fieldOf } = await import("../../scripts/library/mit-ocw.mjs");
  it("files a course by its department, refined by its title", () => {
    expect(fieldOf("Sloan School of Management", "Marketing Management")).toBe("business");
    expect(fieldOf("Sloan School of Management", "Finance Theory I")).toBe("economics");
    expect(fieldOf("Electrical Engineering and Computer Science", "Circuits and Electronics")).toBe("engineering");
    expect(fieldOf("Electrical Engineering and Computer Science", "Introduction to Algorithms")).toBe("programming");
    expect(fieldOf("Somewhere new", "Anything")).toBe("general");
    expect(fieldOf("Athletics, Physical Education and Recreation", "Archery")).toBe("fitness");
    expect(fieldOf("Athletics, Physical Education and Recreation", "Designing Your Life")).toBe("skills");
  });
  it("keeps a course's term, level, instructors and videos, and no description", () => {
    const c = courseOf({
      id: 1,
      readable_id: "2.032+fall_2004",
      title: "Dynamics",
      url: "https://ocw.mit.edu/courses/2-032-dynamics-fall-2004/",
      description: "Not kept.",
      departments: [{ name: "Mechanical Engineering" }],
      course_feature: ["Lecture Notes", "Lecture Videos"],
      best_run_id: 9,
      runs: [{ run_id: 9, semester: "Fall", year: 2004, level: [{ name: "Graduate" }], instructors: [{ full_name: "Prof. George Haller" }] }],
    });
    expect(c).toEqual({
      id: "2.032+fall_2004",
      title: "Dynamics",
      number: "2.032",
      subject: "engineering",
      department: "Mechanical Engineering",
      term: "Fall 2004",
      level: "Graduate",
      instructors: "Prof. George Haller",
      video: true,
      url: "https://ocw.mit.edu/courses/2-032-dynamics-fall-2004/",
    });
    expect(courseOf({ title: "x", url: "https://example.com/" })).toBeNull();
  });
});

describe("the awesome lists' parsers", async () => {
  // @ts-expect-error: a build script, plain JavaScript.
  const { parseMath, parseCertificates, parseYouTubers } = await import("../../scripts/library/awesome-lists.mjs");
  it("reads awesome-math's links, leaving out paid ones and what is not material", () => {
    const md = [
      "## Contents",
      "* [Algebra](#algebra)",
      "### Video Courses and Series",
      "* [3Blue1Brown](https://www.youtube.com/@3blue1brown) - Visual explanations.",
      "### Logic",
      "* [Book of Proof](https://example.org/bop/) - Richard Hammack.",
      "* [How to Prove It](https://example.org/hpi) - Paid textbook by Daniel J. Velleman.",
      "### Mathematical Finance",
      "* [Stochastic Calculus](https://example.org/sc.pdf)",
      "### Meetings and Conferences",
      "* [MathsJam](https://mathsjam.com/) - Meetups.",
    ].join("\n");
    expect(parseMath(md)).toEqual([
      { kind: "course", subject: "maths", title: "3Blue1Brown", about: "Visual explanations.", section: "Video Courses and Series", url: "https://www.youtube.com/@3blue1brown", video: true },
      { kind: "book", subject: "maths", title: "Book of Proof", about: "Richard Hammack.", section: "Logic", url: "https://example.org/bop/" },
      { kind: "book", subject: "economics", title: "Stochastic Calculus", section: "Mathematical Finance", url: "https://example.org/sc.pdf" },
    ]);
  });
  it("reads awesome-certificates' tables and awesome-youtubers' channels", () => {
    const certs = [
      "### Finance",
      "| Course Name | Course Provider | Level | Hour(s) | Reward |",
      '| <a href="https://example.org/f" target="_blank">Finance Basics</a> | Acme &amp; Co |Beginner| 2.5 | 🏆 |',
    ].join("\n");
    expect(parseCertificates(certs)).toEqual([
      { kind: "course", subject: "economics", title: "Finance Basics", author: "Acme & Co", section: "Finance, Beginner", hours: 2.5, url: "https://example.org/f" },
    ]);
    const tubes = ["## Life Skills", "[**Ali Abdaal**](https://www.youtube.com/c/aliabdaal) \\", "Content about: Productivity, Studying \\", "[**Bare**](https://www.youtube.com/bare) \\", "[**Ania**](https://www.youtube.com/c/AniaKub%C3%B3w/featured) \\", "## Other languages", "[**X**](https://www.youtube.com/c/x) \\"].join("\n");
    expect(parseYouTubers(tubes)).toEqual([
      { kind: "course", subject: "skills", title: "Ali Abdaal", about: "Productivity, Studying", section: "Life Skills", url: "https://www.youtube.com/c/aliabdaal", video: true, channel: true },
      { kind: "course", subject: "skills", title: "Ania", section: "Life Skills", url: "https://www.youtube.com/c/AniaKub%C3%B3w/featured", video: true, channel: true },
    ]);
  });
});
