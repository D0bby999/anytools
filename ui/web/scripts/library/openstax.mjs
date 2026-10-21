/**
 * openstax.mjs
 * Writes the Library's textbook catalogue (the private design notes, phase 7) from OpenStax's CMS API: app/data/library/textbooks.json,
 * the live books with their subject, language, licence, page and PDF.
 *
 * Usage: node scripts/library/openstax.mjs
 *
 * Only the catalogue is kept (titles and links); no book's text or cover is
 * copied. Each book's licence is the one the API gives it: most are CC BY-NC-
 * SA, a few CC BY, and the Spanish editions give none.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../app/data/library/textbooks.json");
const API = "https://openstax.org/apps/cms/api/v2/pages/?type=books.Book&fields=title,book_state,license_name,book_subjects,webview_rex_link,high_resolution_pdf_url&limit=250";

const SUBJECTS = {
  Math: "maths",
  Matemáticas: "maths",
  Science: "science",
  Ciencia: "science",
  Nursing: "health",
  "Computer Science": "programming",
  Business: "business",
  Empresarial: "business",
  "Social Sciences": "social",
  Humanities: "humanities",
  "College Success": "skills",
};

/** The Library's field for a book: its first OpenStax subject, economics and finance by title. */
export function subjectOf(subject, title) {
  if (/econom|financ|accounting|contabilidad|finanzas/i.test(title)) return "economics";
  return SUBJECTS[subject] ?? "general";
}
const SPANISH = new Set(["Matemáticas", "Ciencia", "Empresarial"]);

/** The licence's kind, from the API's name for it. */
export function licenceOf(name) {
  if (name === "Creative Commons Attribution License") return "cc-by";
  if (name === "Creative Commons Attribution-NonCommercial-ShareAlike License") return "cc-by-nc-sa";
  return "none";
}

/** A live book as a catalogue entry, or null. */
export function bookOf(b) {
  if (b.book_state !== "live" || !b.meta?.slug) return null;
  const subjects = (b.book_subjects ?? []).map((s) => s.subject_name);
  const pdf = b.high_resolution_pdf_url?.startsWith("https://") ? b.high_resolution_pdf_url : undefined;
  return {
    slug: b.meta.slug,
    title: b.title.trim(),
    language: subjects.some((s) => SPANISH.has(s)) ? "es" : "en",
    subject: subjectOf(subjects[0], b.title),
    section: subjects[0] ?? "",
    licence: licenceOf(b.license_name),
    url: `https://openstax.org/details/books/${b.meta.slug}`,
    ...(pdf ? { pdf } : {}),
  };
}

async function main() {
  const res = await fetch(API, { headers: { "User-Agent": "AnyTools textbook catalogue" } });
  if (!res.ok) throw new Error(`${API}: ${res.status}`);
  const books = (await res.json()).items.map(bookOf).filter(Boolean);
  books.sort((a, b) => a.title.localeCompare(b.title));
  writeFileSync(OUT, JSON.stringify({ source: "https://openstax.org", read: new Date().toISOString().slice(0, 10), books }, null, 1) + "\n");
  const by = (k) => Object.entries(books.reduce((m, b) => ({ ...m, [b[k]]: (m[b[k]] ?? 0) + 1 }), {}));
  console.log(`${books.length} live books; licences ${JSON.stringify(by("licence"))}; languages ${JSON.stringify(by("language"))}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
