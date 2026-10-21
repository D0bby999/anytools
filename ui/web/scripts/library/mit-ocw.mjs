/**
 * mit-ocw.mjs
 * Writes the Library's MIT OpenCourseWare courses
 * (the private design notes): app/data/library/mit-ocw.json,
 * every OCW course in the MIT Learn API with its field, term, instructors,
 * whether it has lecture videos, and how many times MIT Learn says its page
 * was viewed.
 *
 * Usage:
 *   node scripts/library/mit-ocw.mjs               (reads the API)
 *   node scripts/library/mit-ocw.mjs courses.json  (the API's results, saved)
 *
 * The courses are CC BY-NC-SA, so the Library lists them and opens them at
 * MIT; only titles, departments, terms, instructors' names and links are
 * kept, no description or picture.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../app/data/library/mit-ocw.json");
const API = "https://api.learn.mit.edu/api/v1/courses/?platform=ocw&limit=100";

const DEPARTMENTS = {
  "Electrical Engineering and Computer Science": "programming",
  "Institute for Data, Systems, and Society": "programming",
  Mathematics: "maths",
  "Sloan School of Management": "business",
  Economics: "economics",
  "Urban Studies and Planning": "social",
  "Political Science": "social",
  Anthropology: "social",
  "Science, Technology, and Society": "social",
  "Women's and Gender Studies": "social",
  Literature: "humanities",
  History: "humanities",
  "Linguistics and Philosophy": "humanities",
  Music: "humanities",
  "Theater Arts": "humanities",
  "Global Studies and Languages": "languages",
  "Comparative Media Studies/Writing": "media",
  "Media Arts and Sciences": "media",
  "Health Sciences and Technology": "health",
  Physics: "science",
  Biology: "science",
  Chemistry: "science",
  "Earth, Atmospheric, and Planetary Sciences": "science",
  "Brain and Cognitive Sciences": "science",
  Architecture: "engineering",
  "Mechanical Engineering": "engineering",
  "Civil and Environmental Engineering": "engineering",
  "Aeronautics and Astronautics": "engineering",
  "Materials Science and Engineering": "engineering",
  "Chemical Engineering": "engineering",
  "Nuclear Science and Engineering": "engineering",
  "Biological Engineering": "engineering",
  "Engineering Systems Division": "engineering",
  "Athletics, Physical Education and Recreation": "fitness",
};

/** The Library's field for a course: its first department's, refined by the title where a department spans two. */
export function fieldOf(department, title) {
  const field = DEPARTMENTS[department] ?? "general";
  if (field === "programming" && department.startsWith("Electrical") && /circuit|electr|signal|power|semiconductor|devices|electromagnet|photonic|optic|antenna|microwave/i.test(title)) return "engineering";
  if (field === "business" && /financ|accounting|econom/i.test(title)) return "economics";
  if (department === "Linguistics and Philosophy" && /linguist|syntax|semantic|phonolog|morpholog|language/i.test(title)) return "languages";
  if (field === "fitness" && /design|life|career/i.test(title)) return "skills";
  return field;
}

/** A course as a catalogue entry, or null. */
export function courseOf(c) {
  const url = typeof c.url === "string" && c.url.startsWith("https://ocw.mit.edu/courses/") ? c.url : null;
  if (!url || !c.title) return null;
  const department = c.departments?.[0]?.name ?? "";
  const run = c.runs?.find((r) => r.run_id === c.best_run_id) ?? c.runs?.[0];
  const term = [run?.semester, run?.year].filter(Boolean).join(" ");
  const instructors = (run?.instructors ?? []).map((i) => i.full_name?.trim()).filter(Boolean);
  return {
    id: c.readable_id || String(c.id),
    title: c.title.trim(),
    number: (c.readable_id ?? "").split("+")[0] || undefined,
    subject: fieldOf(department, c.title),
    department,
    ...(term ? { term } : {}),
    ...(run?.level?.[0]?.name ? { level: run.level[0].name } : {}),
    ...(instructors.length ? { instructors: instructors.slice(0, 3).join("; ") } : {}),
    ...((c.course_feature ?? []).some((f) => /video/i.test(f)) ? { video: true } : {}),
    ...(Number(run?.year) > 1900 ? { year: Number(run.year) } : {}),
    ...(Number(c.views) > 0 ? { views: Number(c.views) } : {}),
    url,
  };
}

/**
 * The order the Library shows a field's courses in: with lecture videos
 * first, then undergraduate before graduate, then the most recent term, then
 * by title; the first screen shows the first of them.
 */
const year = (c) => Number(/\d{4}/.exec(c.term ?? "")?.[0] ?? 0);
export function featured(a, b) {
  return (
    Number(Boolean(b.video)) - Number(Boolean(a.video)) ||
    Number(b.level === "Undergraduate") - Number(a.level === "Undergraduate") ||
    year(b) - year(a) ||
    a.title.localeCompare(b.title) ||
    a.id.localeCompare(b.id)
  );
}

async function readAPI() {
  const courses = [];
  for (let url = API; url; ) {
    let page;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, { headers: { "User-Agent": "AnyTools course catalogue" }, signal: AbortSignal.timeout(90_000) });
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        page = await res.json();
        break;
      } catch (err) {
        if (attempt >= 5) throw err;
        await new Promise((r) => setTimeout(r, 5_000 + 5_000 * attempt));
      }
    }
    courses.push(...page.results);
    url = page.next ?? null;
  }
  return courses;
}

async function main() {
  const saved = process.argv[2];
  const raw = saved ? JSON.parse(readFileSync(saved, "utf8")) : await readAPI();
  const seen = new Set();
  const courses = raw
    .map(courseOf)
    .filter((c) => c && !seen.has(c.url) && seen.add(c.url))
    .map((c) => JSON.parse(JSON.stringify(c)));
  courses.sort(featured);
  writeFileSync(OUT, JSON.stringify({ source: "https://ocw.mit.edu", read: new Date().toISOString().slice(0, 10), courses }) + "\n");
  const by = courses.reduce((m, c) => ({ ...m, [c.subject]: (m[c.subject] ?? 0) + 1 }), {});
  console.log(`${courses.length} of ${raw.length} courses; ${courses.filter((c) => c.video).length} with lecture videos; fields ${JSON.stringify(by)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
