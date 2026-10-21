/**
 * library/catalogue.server.ts
 * Every item the Library offers (the private design notes),
 * built from the bundled data in catalogue order. export.server.ts turns it
 * into the export the API loads into Postgres, where the page's filters
 * and sorts run (the private design notes). Build-time and
 * tests only: the page asks the API.
 */
import { LIBRARY as DECKS } from "~/lib/deck-library";
import fpb from "~/data/library/free-programming-books.json";
import { WORD_LISTS } from "~/lib/library/word-lists";
import questionSets from "~/data/library/question-sets.json";
import textbooks from "~/data/library/textbooks.json";
import gutenberg from "~/data/library/gutenberg.json";
import openTextbooks from "~/data/library/open-textbooks.json";
import mitOcw from "~/data/library/mit-ocw.json";
import mitxOnline from "~/data/library/mitx-online.json";
import awesome from "~/data/library/awesome.json";
import type { LibraryItem, LibraryLevel } from "~/lib/library/types";

/**
 * A textbook is opened, its PDF downloaded by the learner; one whose licence
 * forbids commercial use says it is for their own study.
 */
const textbookWhy = (licence: string) => (licence.includes("nc") ? "textbookNonCommercial" : "textbook");

/** Material AnyLearn may not copy: listed, opened at its source. */
const LINK_ONLY: LibraryItem[] = [
  {
    id: "up-word-lists",
    kind: "words",
    subject: "languages",
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
    subject: "skills",
    language: "mul",
    name: "up: a guide to learning",
    aboutKey: "library:items.upGuide",
    licence: "cc-by-nc",
    source: { name: "byoungd/up", url: "https://github.com/byoungd/up" },
    url: "https://byoungd.github.io/up/en/",
    action: { type: "open", why: "nonCommercial" },
  },
  {
    id: "khan-academy",
    kind: "course",
    subject: "general",
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
    subject: "education",
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
    action: { type: "open", why: textbookWhy(b.licence), pdf: b.pdf },
  }));
}

/**
 * The Open Textbook Library's books (the private design notes),
 * each with its own licence: opened at its page, with its PDF where the link
 * is one. Like OpenStax's, a whole book is usually past the 400 pages a
 * knowledge base reads, so the learner uploads the chapters they need.
 */
type OtlBook = (typeof openTextbooks.books)[number] & {
  author?: string;
  pdf?: string;
  rating?: number;
  reviews?: number;
  scores?: Record<string, number>;
  year?: number;
  accessibility?: string[];
};

function openTextbookItems(): LibraryItem[] {
  const source = { name: "Open Textbook Library", url: openTextbooks.source };
  return openTextbooks.books.map((b: OtlBook) => ({
    id: `otl:${b.id}`,
    kind: "textbook",
    subject: b.subject as LibraryItem["subject"],
    language: b.language,
    name: b.title,
    author: b.author,
    section: b.section || undefined,
    year: b.year,
    ...(b.rating && b.reviews ? { rating: { value: b.rating, count: b.reviews, scores: b.scores } } : {}),
    accessibility: b.accessibility,
    licence: b.licence as LibraryItem["licence"],
    credit: "credits.otl",
    source,
    url: b.url,
    action: { type: "open", why: textbookWhy(b.licence), pdf: b.pdf },
  }));
}

type MitCourse = (typeof mitOcw.courses)[number] & {
  number?: string;
  term?: string;
  level?: string;
  instructors?: string;
  video?: boolean;
  year?: number;
  views?: number;
};

/** MIT's levels as the Library's; its own label stays in the item's section. */
const MIT_LEVELS: Record<string, LibraryLevel> = { "High School": "beginner", Undergraduate: "intermediate", Graduate: "advanced" };

/** MIT OpenCourseWare's courses, filed by department: non-commercial, so opened at MIT. */
function mitItems(): LibraryItem[] {
  const source = { name: "MIT OpenCourseWare", url: mitOcw.source };
  return (mitOcw.courses as MitCourse[]).map((c) => ({
    id: `mit:${c.id}`,
    kind: "course",
    subject: c.subject as LibraryItem["subject"],
    language: "en",
    name: c.title,
    author: c.instructors,
    section: [c.number, c.department, c.level, c.term].filter(Boolean).join(", ") || undefined,
    video: c.video,
    level: c.level ? MIT_LEVELS[c.level] : undefined,
    year: c.year,
    popularity: c.views ? { count: c.views, kind: "views" as const } : undefined,
    licence: "cc-by-nc-sa",
    credit: "credits.mit",
    source,
    url: c.url,
    action: { type: "open", why: "nonCommercial" },
  }));
}

type MitxCourse = (typeof mitxOnline.courses)[number] & { priceMin?: number; priceMax?: number; hours?: number; commitment?: string; views?: number };

/**
 * MITx Online's courses that are free to take and give a certificate for a
 * fee (the private design notes): taken at MITx Online.
 */
function mitxItems(): LibraryItem[] {
  const source = { name: "MITx Online", url: mitxOnline.source };
  return (mitxOnline.courses as MitxCourse[]).map((c) => ({
    id: `mitx:${c.id}`,
    kind: "course",
    subject: c.subject as LibraryItem["subject"],
    language: "en",
    name: c.title,
    section: [c.department, c.commitment].filter(Boolean).join(", ") || undefined,
    hours: c.hours,
    certificate: { kind: "paid" as const, name: c.certificate, priceMin: c.priceMin, priceMax: c.priceMax, currency: "USD" as const },
    popularity: c.views ? { count: c.views, kind: "views" as const } : undefined,
    licence: "free-access",
    credit: "credits.mitx",
    source,
    url: c.url,
    action: { type: "open", why: "enrol" },
  }));
}

type AwesomeItem = (typeof awesome.lists)[number]["items"][number] & {
  about?: string;
  author?: string;
  hours?: number;
  video?: boolean;
  level?: string;
  certificate?: "free" | "badge";
};

/** Links from three CC0 lists in sindresorhus/awesome: added through the link import (a channel as a feed). */
function awesomeItems(): LibraryItem[] {
  return awesome.lists.flatMap((l) => {
    const source = { name: l.repo, url: `https://github.com/${l.repo}` };
    return (l.items as AwesomeItem[]).map((i) => ({
      id: i.id,
      kind: i.kind as "course" | "book",
      subject: i.subject as LibraryItem["subject"],
      language: "en",
      name: i.title,
      about: i.about,
      author: i.author,
      section: i.section,
      video: i.video,
      hours: i.hours,
      level: i.level as LibraryLevel | undefined,
      certificate: i.certificate ? { kind: i.certificate } : undefined,
      licence: "free-access" as const,
      credit: `credits.awesome.${l.id}`,
      source,
      url: i.url,
      action: { type: "link" as const, url: i.url },
    }));
  });
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
      popularity: b.downloads ? { count: b.downloads, kind: "downloads" as const } : undefined,
      licence: "public-domain",
      credit: "credits.gutenberg",
      source: { name: "Project Gutenberg", url: `https://www.gutenberg.org/ebooks/${b.id}` },
      url,
      action: { type: "link", url },
    };
  });
}

let built: { items: LibraryItem[]; byId: Map<string, LibraryItem> } | null = null;

/** The catalogue, built on first use. */
export function catalogue() {
  if (built) return built;
  const items = [
    ...deckItems(),
    ...wordListItems(),
    ...questionSetItems(),
    ...LINK_ONLY,
    ...textbookItems(),
    ...openTextbookItems(),
    ...mitItems(),
    ...mitxItems(),
    ...awesomeItems(),
    ...gutenbergItems(),
    ...fpbItems(),
  ];
  const byId = new Map(items.map((i) => [i.id, i]));
  if (byId.size !== items.length) throw new Error("library: two items share an id");
  built = { items, byId };
  return built;
}

