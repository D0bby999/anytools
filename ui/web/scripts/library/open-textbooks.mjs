/**
 * open-textbooks.mjs
 * Writes the Library's textbooks from the Open Textbook Library (University
 * of Minnesota; the private design notes):
 * app/data/library/open-textbooks.json, every book in its catalogue API with
 * its field, language, licence, page and, where the link is a PDF, its PDF.
 *
 * Usage:
 *   node scripts/library/open-textbooks.mjs              (reads the API)
 *   node scripts/library/open-textbooks.mjs books.json   (the API's books, saved)
 *
 * Only the catalogue is kept (titles, authors, subjects, licences, links,
 * year, accessibility features) and the reviews' numbers: the book's rating
 * out of 5, how many reviewed it, and the average of each criterion the
 * reviewers score from 1 to 5. No description, review text or cover is
 * copied; a book links to its page, where the reviews are. Each book keeps
 * the licence the API gives it.
 * Books OpenStax publishes are left out; the Library lists OpenStax's own
 * catalogue (openstax.mjs).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../app/data/library/open-textbooks.json");
const API = "https://open.umn.edu/opentextbooks/textbooks.json";

const LICENCES = {
  Attribution: "cc-by",
  "Attribution-ShareAlike": "cc-by-sa",
  "No Rights Reserved": "cc0",
  "Free Documentation License (GNU)": "gfdl",
  "Attribution-NonCommercial": "cc-by-nc",
  "Attribution-NonCommercial-ShareAlike": "cc-by-nc-sa",
  "Attribution-NonCommercial-NoDerivs": "cc-by-nc-nd",
  "Attribution-NoDerivs": "cc-by-nd",
};

/** The API's ISO 639-2 codes, as the Library's. */
const LANGUAGES = {
  eng: "en", spa: "es", fre: "fr", dut: "nl", ger: "de", chi: "zh", pol: "pl", jpn: "ja", gre: "el", kor: "ko",
  por: "pt", bul: "bg", rus: "ru", aze: "az", slv: "sl", ukr: "uk", swa: "sw", ita: "it", ara: "ar", vie: "vi",
};

/** A subject that files a book in another field than its parent's. */
const CHILD_FIELDS = { Accounting: "economics", Finance: "economics", Economics: "economics", Languages: "languages", Linguistics: "languages" };
const FIELDS = {
  Business: "business",
  "Computer Science": "programming",
  Education: "education",
  "Engineering & Technology": "engineering",
  Humanities: "humanities",
  "Journalism, Media Studies & Communications": "media",
  Law: "law",
  Mathematics: "maths",
  Medicine: "health",
  "Natural Sciences": "science",
  "Social Sciences": "social",
  "Student Success": "skills",
};

/** The same top subjects by id, for a book that names only a child subject. */
const PARENT_FIELDS = { 2: "business", 3: "programming", 5: "education", 6: "humanities", 7: "maths", 8: "science", 9: "social", 10: "skills", 11: "law", 13: "engineering", 16: "media", 17: "health" };

/** The Library's field and the heading shown for a book, from its subjects. */
export function fieldOf(subjects) {
  const child = subjects.find((s) => CHILD_FIELDS[s.name]);
  if (child) return { subject: CHILD_FIELDS[child.name], section: child.name };
  const named = subjects.find((s) => s.parent_subject_id) ?? subjects[0];
  const top = subjects.find((s) => !s.parent_subject_id && FIELDS[s.name]);
  const parent = subjects.find((s) => PARENT_FIELDS[s.parent_subject_id]);
  return { subject: top ? FIELDS[top.name] : parent ? PARENT_FIELDS[parent.parent_subject_id] : "general", section: named?.name ?? "" };
}

/** The criteria each review scores from 1 to 5 (the API's "<name>_rating"). */
export const CRITERIA = ["comprehensiveness", "accuracy", "relevance", "clarity", "consistency", "modularity", "organization", "interface", "grammatical", "cultural"];

/** The average of each criterion over the reviews that score it, to two decimals. */
export function scoresOf(reviews) {
  const out = {};
  for (const c of CRITERIA) {
    const got = (reviews ?? []).map((r) => Number(r[`${c}_rating`])).filter((n) => n >= 1 && n <= 5);
    if (got.length) out[c] = Math.round((got.reduce((a, b) => a + b, 0) / got.length) * 100) / 100;
  }
  return out;
}

const fullName = (c) => [c.first_name, c.middle_name, c.last_name].filter(Boolean).join(" ").trim();

/** A book as a catalogue entry, or null if the Library does not list it. */
export function bookOf(b) {
  const language = LANGUAGES[b.language];
  const licence = LICENCES[b.license];
  const url = typeof b.url === "string" && b.url.startsWith("https://open.umn.edu/") ? b.url : null;
  if (!language || !licence || !url || !b.title) return null;
  if ((b.formats ?? []).some((f) => /^https?:\/\/(www\.)?openstax\.org\//.test(f.url ?? ""))) return null;
  // A PDF link only where it is one: most "PDF" formats are a page to download it from.
  // A file on GitHub is linked raw: its /blob/ address is a page about it.
  const pdf = (b.formats ?? [])
    .find((f) => f.type === "PDF" && /^https:\/\/[^?#]+\.pdf$/i.test(f.url ?? ""))
    ?.url.replace(/^(https:\/\/github\.com\/[^/]+\/[^/]+)\/blob\//, "$1/raw/");
  const authors = (b.contributors ?? []).filter((c) => c.contribution === "Author" || c.contribution === "Editor").map(fullName).filter(Boolean);
  const rating = Number(b.rating);
  const reviews = Number(b.textbook_reviews_count) || 0;
  const scores = scoresOf(b.reviews);
  const year = Number(b.copyright_year);
  const accessibility = (b.accessibility_features ?? []).filter((f) => f && f !== "unknown" && f !== "none");
  return {
    id: b.id,
    title: b.title.trim(),
    ...(authors.length ? { author: [...new Set(authors)].slice(0, 3).join("; ") } : {}),
    language,
    ...fieldOf(b.subjects ?? []),
    licence,
    url,
    ...(pdf ? { pdf } : {}),
    ...(rating > 0 && reviews > 0 ? { rating, reviews } : {}),
    ...(Object.keys(scores).length ? { scores } : {}),
    ...(year >= 1900 && year <= 2100 ? { year } : {}),
    ...(accessibility.length ? { accessibility } : {}),
  };
}

const REUSABLE = new Set(["cc-by", "cc-by-sa", "cc0", "gfdl"]);

/**
 * The order the Library shows a field's books in: free to reuse with a PDF
 * first, then free to reuse, then the rest; within each the best rated
 * first, then by title. The first screen shows the first of them.
 */
export function featured(a, b) {
  const rank = (x) => (REUSABLE.has(x.licence) ? (x.pdf ? 0 : 1) : 2);
  return rank(a) - rank(b) || (b.rating ?? 0) - (a.rating ?? 0) || a.title.localeCompare(b.title) || a.id - b.id;
}

async function readAPI() {
  const books = [];
  for (let url = API; url; ) {
    let page;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, { headers: { "User-Agent": "AnyTools textbook catalogue" }, signal: AbortSignal.timeout(90_000) });
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        page = await res.json();
        break;
      } catch (err) {
        if (attempt >= 7) throw err;
        await new Promise((r) => setTimeout(r, 10_000 + 5_000 * attempt));
      }
    }
    books.push(...page.data);
    url = page.links?.next ?? null;
  }
  return books;
}

async function main() {
  const saved = process.argv[2];
  const raw = saved ? JSON.parse(readFileSync(saved, "utf8")) : await readAPI();
  const books = raw.map(bookOf).filter(Boolean);
  books.sort(featured);
  writeFileSync(OUT, JSON.stringify({ source: "https://open.umn.edu/opentextbooks", read: new Date().toISOString().slice(0, 10), books }) + "\n");
  const by = (k) => JSON.stringify(Object.fromEntries(Object.entries(books.reduce((m, b) => ({ ...m, [b[k]]: (m[b[k]] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1])));
  console.log(`${books.length} of ${raw.length} books; licences ${by("licence")}; fields ${by("subject")}; languages ${by("language")}; ${books.filter((b) => b.pdf).length} with a PDF link`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
