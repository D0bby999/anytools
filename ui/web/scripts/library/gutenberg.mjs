/**
 * gutenberg.mjs
 * Writes the Library's free books (the private design notes,
 * phase 8): app/data/library/gutenberg.json, Project Gutenberg's most
 * downloaded public-domain books in each language the Library offers.
 *
 * Usage:
 *   curl -O https://www.gutenberg.org/cache/epub/feeds/rdf-files.tar.bz2
 *   mkdir rdf && tar -xjf rdf-files.tar.bz2 -C rdf
 *   node scripts/library/gutenberg.mjs rdf <the dump's sha256>
 *
 * Read from Gutenberg's own catalogue dump (one RDF file a book, with its
 * downloads in the last 30 days) because Gutendex, the JSON API over it,
 * answered in a minute or more a page on 2026-10-21. Kept: texts "Public
 * domain in the USA", in one language, whose HTML edition is at most 5 MB
 * (what the link import reads). Only titles, authors and links are kept; a
 * learner adds a book to a knowledge base through the link import.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../app/data/library/gutenberg.json");
/** The most downloaded books kept per language. */
const TOP = { en: 500, es: 100, pt: 100, fr: 100, de: 100, it: 100, zh: 50, ja: 50, vi: 50, nl: 50, ru: 50 };
/** security.MaxFetchBytes: the link import's limit. */
const MAX_HTML = 5 << 20;

const all = (re, s) => [...s.matchAll(re)].map((m) => decode(m[1]));
const one = (re, s) => {
  const m = re.exec(s);
  return m ? decode(m[1]) : "";
};
function decode(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => (Number(n) < 32 ? " " : String.fromCodePoint(Number(n))))
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The Library's field for a book, from Gutenberg's "Category:" shelves: the
 * first field-specific shelf in this order, else humanities (literature,
 * history, philosophy, the most of them).
 */
const FIELDS = [
  [/^Mathematics$/, "maths"],
  [/^Health & Medicine$/, "health"],
  [/^(Engineering & Technology|Architecture)$/, "engineering"],
  [/^(Science - |Nature\/)/, "science"],
  [/^Business\/Management$/, "business"],
  [/^Economics$/, "economics"],
  [/^Law & Criminology$/, "law"],
  [/^Teaching & Education$/, "education"],
  [/^Journalism\/Media\/Writing$/, "media"],
  [/^Language & Communication$/, "languages"],
  [/^(Psychiatry\/Psychology|Sociology|Politics|Archaeology & Anthropology|Gender & Sexuality Studies)$/, "social"],
  [/^(How To \.\.\.|Cooking & Drinking)$/, "skills"],
  [/^Encyclopedias\/Dictionaries\/Reference$/, "general"],
];
export function subjectOf(shelves) {
  const categories = shelves.filter((s) => s.startsWith("Category: ")).map((s) => s.slice(10));
  for (const [re, field] of FIELDS) if (categories.some((c) => re.test(c))) return field;
  return "humanities";
}

/** One book's RDF as a catalogue entry, or null if it is not one to offer. */
export function bookOf(rdf) {
  const id = Number(one(/<pgterms:ebook rdf:about="ebooks\/(\d+)"/, rdf));
  if (!id || one(/<dcterms:rights>([^<]*)</, rdf) !== "Public domain in the USA.") return null;
  const type = one(/<dcterms:type>\s*<rdf:Description[^>]*>\s*<dcam:memberOf[^>]*\/>\s*<rdf:value>([^<]*)</, rdf) || one(/<dcterms:type>[\s\S]*?<rdf:value>([^<]*)</, rdf);
  if (type !== "Text") return null;
  const languages = all(/<dcterms:language>[\s\S]*?<rdf:value[^>]*>([^<]*)</g, rdf);
  if (languages.length !== 1) return null;
  const html = new RegExp(`<pgterms:file rdf:about="https://www\\.gutenberg\\.org/ebooks/${id}\\.html\\.images">([\\s\\S]*?)</pgterms:file>`).exec(rdf);
  const size = html ? Number(one(/<dcterms:extent[^>]*>(\d+)</, html[1])) : 0;
  if (!size || size > MAX_HTML) return null;
  const shelves = all(/<pgterms:bookshelf>[\s\S]*?<rdf:value>([^<]*)</g, rdf);
  return {
    id,
    title: one(/<dcterms:title>([^<]*)</, rdf),
    author: all(/<dcterms:creator>[\s\S]*?<pgterms:name>([^<]*)</g, rdf).join("; "),
    language: languages[0],
    subject: subjectOf(shelves),
    shelves: [...new Set(shelves.filter((s) => s.startsWith("Category: ")).map((s) => s.slice(10)))].slice(0, 3),
    downloads: Number(one(/<pgterms:downloads[^>]*>(\d+)</, rdf)) || 0,
  };
}

/** The book's HTML edition, read by the link import. */
export const htmlUrl = (id) => `https://www.gutenberg.org/cache/epub/${id}/pg${id}-images.html`;

async function main() {
  const [dir, sha] = process.argv.slice(2);
  if (!dir || !/^[0-9a-f]{64}$/.test(sha ?? "")) throw new Error("usage: gutenberg.mjs <extracted rdf dir> <dump sha256>");
  const epub = join(dir, "cache/epub");
  const byLang = {};
  for (const n of readdirSync(epub)) {
    let rdf;
    try {
      rdf = readFileSync(join(epub, n, `pg${n}.rdf`), "utf8");
    } catch {
      continue;
    }
    const b = bookOf(rdf);
    if (b && TOP[b.language] && b.title) (byLang[b.language] ??= []).push(b);
  }
  const books = Object.entries(byLang).flatMap(([lang, list]) => list.sort((a, b) => b.downloads - a.downloads || a.id - b.id).slice(0, TOP[lang]));
  books.sort((a, b) => b.downloads - a.downloads || a.id - b.id);
  writeFileSync(OUT, JSON.stringify({ source: "https://www.gutenberg.org", dump: sha, read: new Date().toISOString().slice(0, 10), books }) + "\n");
  const by = books.reduce((m, b) => ({ ...m, [b.language]: (m[b.language] ?? 0) + 1 }), {});
  console.log(`${books.length} books:`, JSON.stringify(by));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
