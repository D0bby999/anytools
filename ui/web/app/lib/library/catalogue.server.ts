/**
 * library/catalogue.server.ts
 * Every item the Library offers (the private design notes),
 * built once per process from the bundled data, and the filter the page
 * asks for. Server-side only: thousands of items, of which the page sends
 * one screen to the browser.
 */
import { fold } from "~/lib/vocab-types";
import { LIBRARY as DECKS } from "~/lib/deck-library";
import fpb from "~/data/library/free-programming-books.json";
import { WORD_LISTS } from "~/lib/library/word-lists";
import questionSets from "~/data/library/question-sets.json";
import textbooks from "~/data/library/textbooks.json";
import gutenberg from "~/data/library/gutenberg.json";
import { LIBRARY_PAGE, type LibraryFilter, type LibraryItem } from "~/lib/library/types";

/** Material AnyLearn may not copy: listed, opened at its source. */
const LINK_ONLY: LibraryItem[] = [
  {
    id: "up-word-lists",
    kind: "words",
    subject: "programming",
    language: "en",
    name: "up: English word lists for programmers",
    aboutKey: "library:items.upWords",
    licence: "cc-by-nc",
    source: { name: "byoungd/up", url: "https://github.com/byoungd/up" },
    url: "https://github.com/byoungd/up/tree/main/docs/en/threads/word-list",
    action: { type: "open", why: "nonCommercial" },
  },
  {
    id: "up-guide",
    kind: "book",
    subject: "general",
    language: "mul",
    name: "up: a guide to learning",
    aboutKey: "library:items.upGuide",
    licence: "cc-by-nc",
    source: { name: "byoungd/up", url: "https://github.com/byoungd/up" },
    url: "https://byoungd.github.io/up/en/",
    action: { type: "open", why: "nonCommercial" },
  },
  {
    id: "mit-ocw",
    kind: "course",
    subject: "science",
    language: "en",
    name: "MIT OpenCourseWare",
    aboutKey: "library:items.mitOcw",
    video: true,
    licence: "cc-by-nc-sa",
    source: { name: "MIT", url: "https://ocw.mit.edu" },
    url: "https://ocw.mit.edu/search/?type=course",
    action: { type: "open", why: "nonCommercial" },
  },
  {
    id: "khan-academy",
    kind: "course",
    subject: "maths",
    language: "mul",
    name: "Khan Academy",
    aboutKey: "library:items.khan",
    video: true,
    licence: "cc-by-nc-sa",
    source: { name: "Khan Academy", url: "https://www.khanacademy.org" },
    url: "https://www.khanacademy.org",
    action: { type: "open", why: "nonCommercial" },
  },
  {
    id: "thpt-papers",
    kind: "questions",
    subject: "general",
    language: "vi",
    name: "Đề thi tốt nghiệp THPT",
    nameKey: "library:items.thptName",
    aboutKey: "library:items.thpt",
    licence: "none",
    source: { name: "Bộ Giáo dục và Đào tạo", url: "https://moet.gov.vn" },
    url: "https://moet.gov.vn",
    action: { type: "open", why: "bringFile" },
  },
  {
    id: "body-exercises",
    kind: "course",
    subject: "fitness",
    language: "en",
    name: "Body: exercise library",
    nameKey: "library:items.bodyName",
    aboutKey: "library:items.body",
    count: 1324,
    unit: "exercises",
    licence: "mit",
    creditText: "hasaneyldrm/exercises-dataset (MIT); names in Spanish and Portuguese from wger (CC BY-SA)",
    source: { name: "hasaneyldrm/exercises-dataset", url: "https://github.com/hasaneyldrm/exercises-dataset" },
    url: "/body/library",
    action: { type: "page", to: "/body/library" },
  },
];

/** Library decks as items: the bundled ones added in a tap, the rest opened. */
function deckItems(): LibraryItem[] {
  return DECKS.map((d) => ({
    id: `deck:${d.slug}`,
    kind: "deck",
    subject: d.subject,
    language: d.language,
    name: d.name,
    aboutKey: `vocab:decks.library.about.${d.about}`,
    count: d.cards,
    unit: "cards",
    licence: d.licence,
    source: { name: new URL(d.sourceUrl).pathname.slice(1), url: d.sourceUrl },
    url: d.sourceUrl,
    action: d.bundled ? { type: "deck", slug: d.slug } : { type: "open", why: d.licence === "none" ? "noLicence" : "nonCommercial" },
  }));
}

type FpbItem = (typeof fpb.items)[number] & { author?: string; notes?: string[]; video?: boolean };

/** free-programming-books' courses and books (phase 2): linked, added through the link import. */
function fpbItems(): LibraryItem[] {
  const source = { name: "free-programming-books", url: fpb.source };
  return (fpb.items as FpbItem[]).map((i) => ({
    id: i.id,
    kind: i.kind as "course" | "book",
    subject: i.subject as LibraryItem["subject"],
    language: i.language,
    name: i.title,
    about: i.notes?.join(", "),
    author: i.author,
    section: i.section,
    video: i.video,
    licence: "free-access",
    credit: "credits.fpb",
    source,
    url: i.url,
    action: { type: "link", url: i.url },
  }));
}

/** A source's name from its URL: a GitHub repository's owner/name, else the site. */
function sourceName(url: string) {
  const u = new URL(url);
  return u.hostname === "github.com" ? u.pathname.slice(1).split("/").slice(0, 2).join("/") : u.hostname.replace(/^www\./, "");
}

/** The exam word lists (phase 4): each level added to the language's words. */
function wordListItems(): LibraryItem[] {
  return WORD_LISTS.map((l) => ({
    id: `words:${l.list}`,
    kind: "words",
    subject: "languages",
    language: l.language,
    name: l.name,
    aboutKey: `library:wordLists.${l.list}`,
    count: l.levels.reduce((n, v) => n + v.count, 0),
    unit: "words",
    licence: l.licence,
    creditText: l.credit,
    source: { name: sourceName(l.source), url: l.source },
    url: l.source,
    action: { type: "words", list: l.list, levels: l.levels },
  }));
}

const SET_SUBJECT: Record<string, LibraryItem["subject"]> = { trivia: "general", arc: "science", gsm8k: "maths", python: "programming" };

/** The question sets (phase 5): each part added to a knowledge base's Quiz. */
function questionSetItems(): LibraryItem[] {
  return questionSets.map((s) => ({
    id: `set:${s.id}`,
    kind: "questions",
    subject: SET_SUBJECT[s.id] ?? "general",
    language: "en",
    name: s.name,
    aboutKey: `library:sets.${s.id}`,
    count: s.parts.reduce((n, p) => n + p.count, 0),
    unit: s.id === "python" ? "exercises" : "questions",
    licence: s.licence as LibraryItem["licence"],
    creditText: s.credit,
    source: { name: sourceName(s.source), url: s.source },
    url: s.source,
    action: { type: "set", set: s.id, parts: s.parts },
  }));
}

/**
 * OpenStax's textbooks (phase 7): opened at their page. A whole book's PDF
 * (30 to 60 MB) is past the link import's 5 MB, so the learner downloads it
 * and uploads it, where the upload's 50 MB allows.
 */
function textbookItems(): LibraryItem[] {
  return textbooks.books.map((b: (typeof textbooks.books)[number] & { pdf?: string }) => ({
    id: `openstax:${b.slug}`,
    kind: "textbook",
    subject: b.subject as LibraryItem["subject"],
    language: b.language,
    name: b.title,
    section: b.section,
    licence: b.licence as LibraryItem["licence"],
    source: { name: "OpenStax", url: textbooks.source },
    url: b.url,
    action: { type: "open", why: "textbook", pdf: b.pdf },
  }));
}

/** Project Gutenberg's most read books (phase 8): each added through the link import from its HTML edition. */
function gutenbergItems(): LibraryItem[] {
  return gutenberg.books.map((b) => {
    const url = `https://www.gutenberg.org/cache/epub/${b.id}/pg${b.id}-images.html`;
    return {
      id: `gutenberg:${b.id}`,
      kind: "book",
      subject: b.subject as LibraryItem["subject"],
      language: b.language,
      name: b.title,
      author: b.author || undefined,
      section: b.shelves.join(", ") || undefined,
      licence: "public-domain",
      credit: "credits.gutenberg",
      source: { name: "Project Gutenberg", url: `https://www.gutenberg.org/ebooks/${b.id}` },
      url,
      action: { type: "link", url },
    };
  });
}

let built: { items: LibraryItem[]; byId: Map<string, LibraryItem>; text: string[] } | null = null;

/** The catalogue, built on first use. */
export function catalogue() {
  if (built) return built;
  const items = [...deckItems(), ...wordListItems(), ...questionSetItems(), ...LINK_ONLY, ...textbookItems(), ...gutenbergItems(), ...fpbItems()];
  const byId = new Map(items.map((i) => [i.id, i]));
  if (byId.size !== items.length) throw new Error("library: two items share an id");
  // What a search looks in, folded once.
  const text = items.map((i) => fold([i.name, i.about, i.section, i.author].filter(Boolean).join(" ")));
  built = { items, byId, text };
  return built;
}

export function libraryItem(id: string): LibraryItem | undefined {
  return catalogue().byId.get(id);
}

/** A language matches its own code, a regional one ("pt-BR" for "pt"), and "mul". */
function inLanguage(item: LibraryItem, langs: string[]): boolean {
  if (item.language === "mul") return true;
  const base = item.language.split("-")[0]!;
  return langs.includes(base);
}

/**
 * One page of the items the filter keeps, in catalogue order, and how many
 * there are. ui is the learner's interface language, used when lang is "".
 */
export function findItems(filter: LibraryFilter, ui: string) {
  const { items, text } = catalogue();
  const langs = filter.lang === "all" ? null : filter.lang ? [filter.lang] : [...new Set([ui, "en"])];
  const words = fold(filter.q).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const kept: LibraryItem[] = [];
  items.forEach((item, i) => {
    if (filter.kind && item.kind !== filter.kind) return;
    if (filter.subject && item.subject !== filter.subject) return;
    if (langs && !inLanguage(item, langs)) return;
    if (words.length && !words.every((w) => text[i]!.includes(w))) return;
    kept.push(item);
  });
  // The Library is mostly English (owner, 2026-10-21): English material
  // first, then what is in many languages, then the rest, each in
  // catalogue order (the sort is stable).
  kept.sort((a, b) => languageRank(a) - languageRank(b));
  return { total: kept.length, items: kept.slice(filter.offset, filter.offset + LIBRARY_PAGE) };
}

function languageRank(item: LibraryItem): number {
  const base = item.language.split("-")[0];
  return base === "en" ? 0 : base === "mul" ? 1 : 2;
}

/** The languages the catalogue has material in, for the filter's choices. */
export function catalogueLanguages(): string[] {
  const set = new Set<string>();
  for (const i of catalogue().items) if (i.language !== "mul") set.add(i.language.split("-")[0]!);
  // English first, as the Library is; the others by code.
  return [...set].sort((a, b) => (a === "en" ? -1 : b === "en" ? 1 : a.localeCompare(b)));
}
