/**
 * free-programming-books.mjs
 * Turns the Free Ebook Foundation's free-programming-books lists into the
 * Library's courses and books (the private design notes,
 * phase 2): app/data/library/free-programming-books.json.
 *
 * Usage: node scripts/library/free-programming-books.mjs
 *
 * The lists are CC BY 4.0 (the repository's LICENSE); what they link to is
 * each owner's, free to read or watch at its source, and is never copied:
 * the Library links to it, and a learner may add it to a knowledge base
 * through the link import, as any page they paste. Pinned to COMMIT; move
 * it to take a newer list.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const COMMIT = "eb55e4e8c3ac3a57f89bd36258ab7f826d3a74a6";
const REPO = "https://github.com/EbookFoundation/free-programming-books";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../app/data/library/free-programming-books.json");

/** The files read, with the kind and language of what they list. */
const FILES = [
  ["courses/free-courses-en.md", "course", "en"],
  ["courses/free-courses-vi.md", "course", "vi"],
  ["courses/free-courses-es.md", "course", "es"],
  ["courses/free-courses-pt_BR.md", "course", "pt"],
  ["books/free-programming-books-langs.md", "book", "en"],
  ["books/free-programming-books-subjects.md", "book", "en"],
  ["books/free-programming-books-vi.md", "book", "vi"],
  ["books/free-programming-books-es.md", "book", "es"],
  ["books/free-programming-books-pt_BR.md", "book", "pt"],
];

/** A heading's text: anchors, escapes and emphasis dropped. */
function headingText(raw) {
  return raw
    .replace(/<a [^>]*><\/a>/g, "")
    .replace(/\\(.)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

const ITEM = /^\s*[*-] \[((?:[^\]\\]|\\.)+)\]\((https?:\/\/[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)\)(.*)$/;

/**
 * The items of one list: each `* [Title](url) - Author (note) (note)` under
 * a `###` section and, when there is one, a `####` subsection. The Index
 * section (links to the headings) is skipped.
 */
export function parseList(markdown) {
  const out = [];
  let section = "";
  let sub = "";
  for (const line of markdown.split("\n")) {
    const h = /^(#{2,4}) (.+)$/.exec(line);
    if (h) {
      const text = headingText(h[2]);
      if (h[1].length <= 3) {
        section = text;
        sub = "";
      } else sub = text;
      continue;
    }
    if (!section || /^index$/i.test(section)) continue;
    const m = ITEM.exec(line);
    if (!m) continue;
    const title = m[1].replace(/\\(.)/g, "$1").trim();
    let rest = m[3].trim();
    const notes = [];
    // Trailing "(PDF)", "(HTML)", "(email address *requested*)": the notes.
    for (let n = /\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/.exec(rest); n; n = /\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*$/.exec(rest)) {
      notes.unshift(n[1].replace(/[*_]/g, "").trim());
      rest = rest.slice(0, n.index).trim();
    }
    const author = rest.replace(/^[-–—]\s*/, "").replace(/[*_]/g, "").trim();
    out.push({ title, url: m[2], author, notes, section: sub ? `${section} › ${sub}` : section });
  }
  return out;
}

/** The Library's subject for a section, by its words in the four languages. */
export function subjectOf(section) {
  const s = section.toLowerCase();
  if (/^0 - |mooc|meta-list/.test(s)) return "general";
  if (/math|statistic|calculus|algebra|probabilit|toán|matemát|estatíst|estadíst/.test(s)) return "maths";
  if (/physics|chemistry|biology|bioinformatics|quantum|física|química|biolog|vật lý|hoá học/.test(s)) return "science";
  return "programming";
}

const isVideo = (url) => /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(url);

async function main() {
  const items = [];
  const seen = new Set();
  let skipped = 0;
  for (const [path, kind, language] of FILES) {
    const url = `https://raw.githubusercontent.com/EbookFoundation/free-programming-books/${COMMIT}/${path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    for (const it of parseList(await res.text())) {
      // https only, and each link once per language and kind.
      const key = `${kind}:${language}:${it.url}`;
      if (!it.url.startsWith("https://") || seen.has(key)) {
        skipped++;
        continue;
      }
      seen.add(key);
      items.push({
        id: `fpb:${createHash("sha1").update(key).digest("hex").slice(0, 12)}`,
        kind,
        language,
        subject: subjectOf(it.section),
        title: it.title,
        url: it.url,
        ...(it.author ? { author: it.author } : {}),
        ...(it.notes.length ? { notes: it.notes } : {}),
        section: it.section,
        ...(isVideo(it.url) ? { video: true } : {}),
      });
    }
  }
  const data = { source: REPO, licence: "CC BY 4.0", commit: COMMIT, items };
  writeFileSync(OUT, JSON.stringify(data) + "\n");
  const count = (k, l) => items.filter((i) => i.kind === k && i.language === l).length;
  console.log(
    `${items.length} items (${skipped} skipped: not https, or listed twice);`,
    ["en", "vi", "es", "pt"].map((l) => `${l}: ${count("course", l)} courses, ${count("book", l)} books`).join("; "),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
