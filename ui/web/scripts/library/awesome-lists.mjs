/**
 * awesome-lists.mjs
 * Writes the Library's links from three lists in sindresorhus/awesome, each
 * under CC0 and pinned by commit (the private design notes):
 * app/data/library/awesome.json.
 *
 *   - rossant/awesome-math: free textbooks, notes and video courses in
 *     mathematics; paid ones are left out.
 *   - PanXProject/awesome-certificates: free courses with a certificate, with
 *     their provider and level.
 *   - JoseDeFreitas/awesome-youtubers: YouTube channels that teach, added
 *     as feeds.
 *
 * Usage: node scripts/library/awesome-lists.mjs
 *
 * Each list's licence is read from GitHub at the pinned commit, and the
 * script stops unless it is CC0. Each link belongs to its owner; the Library
 * keeps titles, the lists' own one-line notes, and links. Links to sites the
 * Library lists on its own (Khan Academy, MIT OpenCourseWare, OpenStax) are
 * left out.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../app/data/library/awesome.json");

export const LISTS = [
  { id: "math", repo: "rossant/awesome-math", commit: "21066c9d58e470d5b9030755bf1cb4c77a786a91" },
  { id: "certificates", repo: "PanXProject/awesome-certificates", commit: "c738741ae10b4479996b5d1dc624a05caf3bc93a" },
  { id: "youtubers", repo: "JoseDeFreitas/awesome-youtubers", commit: "eacc1f55a8231114239a6c6cfacd80f1bd78aa1b" },
];

/** Sites the Library lists from their own catalogues or as one entry. */
const LISTED_ELSEWHERE = /^https:\/\/([a-z0-9-]+\.)*(khanacademy\.org|ocw\.mit\.edu|openstax\.org)\//;

const isVideo = (url) => /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//.test(url);
const idOf = (list, url) => `awesome-${list}:${createHash("sha1").update(url).digest("hex").slice(0, 12)}`;
const plain = (s) =>
  s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`]/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** Sections of awesome-math that are not material to learn from. */
const MATH_SKIP = /^(Contents|Questions and Answers|Mathematical Software and Tools|AI for Mathematics|Journals and Magazines|Blogs|Meetings and Conferences|Related Curated Lists|License)$/;

/** awesome-math's "* [Title](url) - note" lines, under their headings. */
export function parseMath(md) {
  const items = [];
  let section = "";
  for (const line of md.split("\n")) {
    const h = /^#{2,4} (.+)$/.exec(line);
    if (h) {
      section = plain(h[1]);
      continue;
    }
    const m = /^\s*[*-] \[([^\]]+)\]\((https:\/\/[^)\s]+)\)\s*(?:[-–—:]\s*(.*))?$/.exec(line);
    if (!m || !section || MATH_SKIP.test(section)) continue;
    const note = plain(m[3] ?? "");
    if (/\bpaid\b/i.test(note)) continue;
    const url = m[2];
    const course = isVideo(url) || /^(Learning Platforms|Video Courses and Series)$/.test(section);
    items.push({
      kind: course ? "course" : "book",
      subject: /^Mathematical Finance$/.test(section) ? "economics" : "maths",
      title: plain(m[1]),
      ...(note ? { about: note } : {}),
      section,
      url,
      ...(isVideo(url) ? { video: true } : {}),
    });
  }
  return items;
}

/** awesome-certificates' headings, as fields. */
const CERTIFICATE_FIELDS = {
  "Business Analytics": "business",
  Entreprenuership: "business",
  Finance: "economics",
  Marketing: "business",
  "Professional Development / Communication": "skills",
  "Project Management": "business",
  Support: "business",
  Design: "humanities",
  Illustrator: "humanities",
  Photoshop: "humanities",
  "Electrical Engineering": "engineering",
  "Robotics and IoT": "engineering",
  Statistics: "maths",
};

/** awesome-certificates' table rows: course, provider, level, hours. */
export function parseCertificates(md) {
  const items = [];
  let section = "";
  for (const line of md.split("\n")) {
    const h = /^#{2,4} (.+)$/.exec(line);
    if (h) {
      section = plain(h[1]);
      continue;
    }
    const row = /^\|\s*<a href="(https:\/\/[^"]+)"[^>]*>([^<]+)<\/a>\s*\|([^|]*)\|([^|]*)\|([^|]*)\|/.exec(line);
    if (!row || !section) continue;
    const [, url, title, provider, level, hours] = row;
    const h2 = Number(hours.trim());
    items.push({
      kind: "course",
      subject: CERTIFICATE_FIELDS[section] ?? "programming",
      title: plain(title),
      ...(plain(provider) ? { author: plain(provider) } : {}),
      section: [section, plain(level)].filter(Boolean).join(", "),
      ...(h2 > 0 ? { hours: h2 } : {}),
      url,
      ...(isVideo(url) ? { video: true } : {}),
    });
  }
  return items;
}

const YOUTUBER_FIELDS = { "Life Skills": "skills", "Digital Design": "humanities", "Audio and Video": "media", Hardware: "engineering" };

/**
 * A channel link the link import follows as a feed (feeds.RecognizeYouTube):
 * /channel/UC…, /@handle, /c/name or /user/name (a name may be
 * percent-encoded), with or without a tab after it. A bare youtube.com/name
 * is left out: whether YouTube still serves it varies by channel.
 */
const CHANNEL = /^https:\/\/(?:www\.)?youtube\.com\/(?:channel\/UC[A-Za-z0-9_-]{22}|@[A-Za-z0-9._-]{3,30}|(?:c|user)\/(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2}){1,300})(?:\/[a-z]+)?\/?$/;

/** awesome-youtubers' channels: "[**Name**](url) \" then "Content about: …". */
export function parseYouTubers(md) {
  const items = [];
  let section = "";
  const lines = md.split("\n");
  lines.forEach((line, i) => {
    const h = /^#{2,4} (.+)$/.exec(line);
    if (h) {
      section = plain(h[1]);
      return;
    }
    const m = /^\[\*\*(.+?)\*\*\]\((https:\/\/(?:www\.)?youtube\.com\/[^)\s]+)\)/.exec(line);
    if (!m || !section || section === "Other languages" || !CHANNEL.test(m[2])) return;
    const about = /^Content about:\s*(.*?)\s*\\?$/.exec(lines[i + 1] ?? "");
    items.push({
      kind: "course",
      subject: YOUTUBER_FIELDS[section] ?? "programming",
      title: plain(m[1]),
      ...(about?.[1] ? { about: plain(about[1]) } : {}),
      section,
      url: m[2],
      video: true,
      channel: true,
    });
  });
  return items;
}

const PARSERS = { math: parseMath, certificates: parseCertificates, youtubers: parseYouTubers };

/** The list's licence at its pinned commit, as GitHub reads it; CC0 or the script stops. */
async function licenceOf(l) {
  const res = await fetch(`https://api.github.com/repos/${l.repo}/license?ref=${l.commit}`, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`${l.repo} licence: ${res.status}`);
  const got = await res.json();
  if (got.license?.spdx_id !== "CC0-1.0") throw new Error(`${l.repo} is ${got.license?.spdx_id ?? "unlicensed"} at ${l.commit}, not CC0-1.0`);
  return `https://github.com/${l.repo}/blob/${l.commit}/${got.path}`;
}

async function main() {
  const lists = [];
  for (const l of LISTS) {
    const licenceFile = await licenceOf(l);
    const url = `https://raw.githubusercontent.com/${l.repo}/${l.commit}/README.md`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const seen = new Set();
    const items = PARSERS[l.id](await res.text())
      .filter((i) => !LISTED_ELSEWHERE.test(i.url) && !seen.has(i.url) && seen.add(i.url))
      .map((i) => ({ id: idOf(l.id, i.url), ...i }));
    lists.push({ ...l, licence: "CC0-1.0", licenceFile, items });
    const by = items.reduce((m, i) => ({ ...m, [i.subject]: (m[i.subject] ?? 0) + 1 }), {});
    console.log(`${l.repo}: ${items.length} links; fields ${JSON.stringify(by)}`);
  }
  writeFileSync(OUT, JSON.stringify({ source: "https://github.com/sindresorhus/awesome", lists }) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
