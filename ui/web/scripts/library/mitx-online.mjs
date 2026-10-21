/**
 * mitx-online.mjs
 * Writes the Library's MITx Online courses (the private design notes): app/data/library/mitx-online.json, the courses in the MIT Learn
 * API that are free to take and give a certificate for a fee, with the
 * certificate's name and fee, the weeks and hours they ask, and their views.
 *
 * Usage:
 *   node scripts/library/mitx-online.mjs               (reads the API)
 *   node scripts/library/mitx-online.mjs courses.json  (the API's results, saved)
 *
 * The courses are MIT's and are taken at MITx Online; only titles,
 * departments, the certificate's facts and links are kept, no description
 * or picture.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fieldOf } from "./mit-ocw.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../app/data/library/mitx-online.json");
const API = "https://api.learn.mit.edu/api/v1/courses/?platform=mitxonline&free=true&certification=true&limit=100";

/** MIT Learn's topics, in the order they decide a field, for a course with no department. */
const TOPIC_FIELDS = [
  [/^(Health & Medicine|Public Health)$/, "health"],
  [/^(Business & Management|Supply Chain|Finance)$/, "business"],
  [/^(Energy|Energy, Climate & Sustainability|Architecture|Engineering)$/, "engineering"],
  [/^(Computer Science|Software Design and Engineering|Machine Learning|Data Science|Data Science, Analytics & Computer Technology)$/, "programming"],
  [/^Mathematics$/, "maths"],
  [/^(History|Humanities)$/, "humanities"],
  [/^Social Sciences$/, "social"],
];

/** A course's field: its department's, else its topics', else statistics and probability as mathematics. */
export function fieldOfCourse(department, title, topics) {
  if (department) return fieldOf(department, title);
  for (const [re, field] of TOPIC_FIELDS) if (topics.some((t) => re.test(t))) return field;
  return /statistic|probabilit|time series/i.test(title) ? "maths" : "general";
}

/** A course as a catalogue entry, or null if it is not free to take or gives no certificate. */
export function courseOf(c) {
  const url = typeof c.url === "string" && c.url.startsWith("https://learn.mit.edu/courses/") ? c.url : null;
  if (!url || !c.title || c.free !== true || c.certification !== true) return null;
  const prices = (c.resource_prices ?? []).filter((p) => p.currency === "USD").map((p) => Number(p.amount)).filter((n) => n > 0);
  const department = c.departments?.[0]?.name ?? "";
  const weeks = Number(c.max_weeks) || 0;
  const weekly = Number(c.max_weekly_hours) || 0;
  return {
    id: c.readable_id || String(c.id),
    title: c.title.trim(),
    subject: fieldOfCourse(department, c.title, (c.topics ?? []).map((t) => t.name)),
    department,
    certificate: c.certification_type?.name ?? "Certificate",
    ...(prices.length ? { priceMin: Math.min(...prices), priceMax: Math.max(...prices) } : {}),
    ...(weeks ? { weeks } : {}),
    ...(weekly ? { weeklyHours: weekly } : {}),
    ...(weeks && weekly ? { hours: weeks * weekly } : {}),
    ...(c.time_commitment ? { commitment: c.time_commitment } : {}),
    ...(Number(c.views) > 0 ? { views: Number(c.views) } : {}),
    url,
  };
}

async function readAPI() {
  const courses = [];
  for (let url = API; url; ) {
    const res = await fetch(url, { headers: { "User-Agent": "AnyTools course catalogue" }, signal: AbortSignal.timeout(90_000) });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const page = await res.json();
    courses.push(...page.results);
    url = page.next ?? null;
  }
  return courses;
}

async function main() {
  const saved = process.argv[2];
  const raw = saved ? JSON.parse(readFileSync(saved, "utf8")) : await readAPI();
  const seen = new Set();
  const courses = raw.map(courseOf).filter((c) => c && !seen.has(c.url) && seen.add(c.url));
  // Most viewed first: the first screen shows the first of them.
  courses.sort((a, b) => (b.views ?? 0) - (a.views ?? 0) || a.title.localeCompare(b.title));
  writeFileSync(OUT, JSON.stringify({ source: "https://mitxonline.mit.edu", read: new Date().toISOString().slice(0, 10), courses }) + "\n");
  const by = courses.reduce((m, c) => ({ ...m, [c.certificate]: (m[c.certificate] ?? 0) + 1 }), {});
  console.log(`${courses.length} of ${raw.length} courses; ${JSON.stringify(by)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
