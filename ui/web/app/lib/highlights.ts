/**
 * highlights.ts
 * Kindle and KOReader highlights as documents (the private design notes, phase 5). A Kindle's `My Clippings.txt` or a KOReader JSON export is
 * read here, in the browser, and each book becomes one Markdown file uploaded
 * to a knowledge base like any other: then the reader, citations, quizzes and
 * the word picker all work on it. The idea is vocabsieve's and fyodor's; none
 * of their code is used.
 *
 * My Clippings.txt is entries separated by "==========": the book's title
 * (with its author in the last parentheses), a line saying what the entry is
 * and where, a blank line, and the text. That second line is in the Kindle's
 * language; it is matched in English, Spanish, Portuguese, French and German
 * (a Kindle has no Vietnamese interface), and an entry whose kind is not
 * recognised is kept as a highlight rather than lost. Bookmarks are dropped,
 * a note is attached to the highlight it was written on, and a highlight the
 * reader edited — Kindle appends the new version — is kept once, as last
 * written.
 */

export type Highlight = {
  text: string;
  note?: string;
  page?: string;
  location?: string;
  added?: string;
  chapter?: string;
};

export type Book = {
  title: string;
  author: string;
  highlights: Highlight[];
  /** Notes not written on any highlight. */
  notes: Highlight[];
};

const SEPARATOR = /^==========\s*$/m;
const BOOKMARK = /bookmark|marcador|signet|lesezeichen|segnalibro/i;
const NOTE = /\b(?:note|nota|notiz)\b/i;
const PAGE = /\b(?:page|página|pagina|seite)\s+([\divxlc-]+)/i;
const LOCATION = /\b(?:location|loc\.|posición|posição|emplacement|position|posizione)\s*([\d-]+)/i;

/** "Title (Author)" → title and author; the author is the last parentheses. */
function titleAndAuthor(line: string): { title: string; author: string } {
  const m = line.match(/^(.*\S)\s*\(([^()]*)\)\s*$/);
  return m ? { title: m[1]!.trim(), author: m[2]!.trim() } : { title: line.trim(), author: "" };
}

/** The first and last location of a range like "180-182" (or "180-82", Kindle's old short form). */
function range(location: string | undefined): [number, number] | null {
  if (!location) return null;
  const [a, b] = location.split("-");
  const start = Number(a);
  if (!Number.isFinite(start)) return null;
  if (!b) return [start, start];
  // "180-82": the end shares the start's leading digits.
  const end = b.length < (a ?? "").length ? Number((a ?? "").slice(0, (a ?? "").length - b.length) + b) : Number(b);
  return [start, Number.isFinite(end) ? end : start];
}

/** Reads My Clippings.txt into books, in the order each book first appears. */
export function parseClippings(text: string): Book[] {
  const books = new Map<string, Book>();
  type Entry = Highlight & { kind: "highlight" | "note" };
  const entries = new Map<string, Entry[]>();
  for (const block of text.replace(/\r\n?/g, "\n").split(SEPARATOR)) {
    const lines = block.replace(/\uFEFF/g, "").split("\n");
    while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
    if (lines.length < 2) continue;
    const head = lines[0]!;
    const meta = lines[1]!.replace(/^\s*-\s*/, "");
    const body = lines.slice(2).join("\n").trim();
    if (BOOKMARK.test(meta) || body === "") continue;
    const { title, author } = titleAndAuthor(head);
    const key = `${title}\u0000${author}`;
    if (!books.has(key)) {
      books.set(key, { title, author, highlights: [], notes: [] });
      entries.set(key, []);
    }
    const parts = meta.split("|").map((p) => p.trim());
    entries.get(key)!.push({
      kind: NOTE.test(parts[0] ?? "") ? "note" : "highlight",
      text: body,
      page: meta.match(PAGE)?.[1],
      location: meta.match(LOCATION)?.[1],
      added: parts.length > 1 ? parts[parts.length - 1] : undefined,
    });
  }
  for (const [key, list] of entries) {
    const book = books.get(key)!;
    // An edited highlight: the same start, written again; the last one stands.
    const byStart = new Map<string, Entry>();
    const order: string[] = [];
    for (const e of list) {
      const id = e.kind === "highlight" ? `h:${range(e.location)?.[0] ?? e.page ?? e.text}` : `n:${order.length}`;
      if (!byStart.has(id)) order.push(id);
      byStart.set(id, e);
    }
    const kept = order.map((id) => byStart.get(id)!);
    const highlights = kept.filter((e) => e.kind === "highlight");
    for (const e of kept.filter((k) => k.kind === "note")) {
      const at = range(e.location)?.[0];
      const on = at === undefined ? undefined : highlights.find((h) => {
        const r = range(h.location);
        return r !== null && at >= r[0] && at <= r[1];
      });
      if (on) on.note = on.note ? `${on.note}\n\n${e.text}` : e.text;
      else book.notes.push(strip(e));
    }
    book.highlights = highlights.map(strip);
  }
  return [...books.values()].filter((b) => b.highlights.length + b.notes.length > 0);
}

function strip({ kind: _kind, ...h }: Highlight & { kind?: string }): Highlight {
  return Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined && v !== "")) as Highlight;
}

type KOReaderEntry = { text?: unknown; note?: unknown; page?: unknown; chapter?: unknown; time?: unknown };
type KOReaderBook = { title?: unknown; author?: unknown; entries?: KOReaderEntry[] };

/** Reads a KOReader JSON export: one book, a list of books, or an object of them. */
export function parseKOReader(json: string): Book[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const found: KOReaderBook[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") {
      if (Array.isArray((v as KOReaderBook).entries)) found.push(v as KOReaderBook);
      else Object.values(v).forEach(visit);
    }
  };
  visit(data);
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
  return found
    .map((b) => {
      const highlights: Highlight[] = [];
      for (const e of b.entries ?? []) {
        const body = text(e.text);
        if (!body) continue;
        const time = typeof e.time === "number" ? new Date(e.time * 1000).toISOString().slice(0, 10) : text(e.time);
        highlights.push(strip({ text: body, note: text(e.note), page: text(e.page), chapter: text(e.chapter), added: time }));
      }
      return { title: text(b.title) || "Untitled", author: text(b.author), highlights, notes: [] };
    })
    .filter((b) => b.highlights.length > 0);
}

/** Reads either kind of export, by its first character. */
export function parseHighlights(text: string): Book[] {
  const trimmed = text.replace(/^\uFEFF/, "").trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[") ? parseKOReader(trimmed) : parseClippings(trimmed);
}

/** The words the Markdown uses around the highlights, in the learner's language. */
export type MarkdownLabels = { by: string; page: string; location: string; note: string; notes: string };

/** One book as a Markdown document. */
export function bookMarkdown(book: Book, labels: MarkdownLabels): string {
  const out = [`# ${book.title}`, ""];
  if (book.author) out.push(`${labels.by} ${book.author}`, "");
  let chapter = "";
  for (const h of book.highlights) {
    if (h.chapter && h.chapter !== chapter) {
      chapter = h.chapter;
      out.push(`## ${chapter}`, "");
    }
    out.push(...quote(h.text), "");
    const where = [h.page ? `${labels.page} ${h.page}` : "", h.location ? `${labels.location} ${h.location}` : "", h.added ?? ""]
      .filter(Boolean)
      .join(" · ");
    if (where) out.push(`*${where}*`, "");
    if (h.note) out.push(`**${labels.note}:** ${h.note}`, "");
  }
  if (book.notes.length > 0) {
    out.push(`## ${labels.notes}`, "");
    for (const n of book.notes) {
      out.push(n.text, "");
      const where = [n.page ? `${labels.page} ${n.page}` : "", n.location ? `${labels.location} ${n.location}` : ""]
        .filter(Boolean)
        .join(" · ");
      if (where) out.push(`*${where}*`, "");
    }
  }
  return `${out.join("\n").trimEnd()}\n`;
}

function quote(text: string): string[] {
  return text.split("\n").map((line) => (line.trim() ? `> ${line}` : ">"));
}

/** The file name a book is uploaded as, which becomes its document's title. */
export function bookFileName(book: Book): string {
  const name = book.title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return `${name || "Highlights"}.md`;
}
