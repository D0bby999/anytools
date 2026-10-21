/**
 * word-lists.mjs
 * Writes the Library's exam word lists (the private design notes, phase 4): app/data/library/words/<list>.json, each with its
 * levels, every word with its meaning in English (and its reading first,
 * for Chinese and Japanese).
 *
 * Usage: node scripts/library/word-lists.mjs
 *
 * Sources, each pinned by sha256:
 *  - NGSL 1.2 and NAWL 1.2 (Browne, Culligan and Phillips), CC BY-SA 4.0,
 *    with the project's definitions in easy English; NGSL in frequency
 *    order (its stats file), in six bands of 500.
 *  - HSK 2.0 (levels 1-6) and 3.0 (1-6, and 7-9), drkameleon/complete-hsk-
 *    vocabulary (MIT), meanings from CC-CEDICT (CC BY-SA 4.0); most
 *    frequent first.
 *  - JLPT N5-N1, jamsinclair/open-anki-jlpt-decks (MIT), lists from
 *    Jonathan Waller's tanos.co.uk (CC BY: "Everything on this site (that
 *    I'm not selling), is licenced under Creative Commons BY", its Sharing
 *    and copyrights page, web.archive.org/web/2019/http://www.tanos.co.uk/
 *    jlpt/sharing/). Its English meanings are taken to come from JMdict/
 *    EDICT (CC BY-SA), so the file is labelled CC BY-SA, as HSK's is.
 *
 * A level of more than SPLIT words is cut into parts of PART, so one tap
 * adds at most 25 days of new words (HSK 3.0's 7–9 is 5,606 words).
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../app/data/library/words");
const UA = { "User-Agent": "Mozilla/5.0 (AnyTools word lists)" };

const NGSL = "https://www.newgeneralservicelist.com/s/";
const HSK_COMMIT = "7ac65bf1a6387d35f1ade478906172a19311c7f9";
const JLPT_COMMIT = "1ad66734417aca9dbcca6b2d5ee440cb13ab3ba0";

const FILES = {
  ngslDefinitions: [`${NGSL}NGSL_12_with_English_definitions.xlsx`, "27f8bb4e0948719ffef01a42de0f9e01089b78a12bd576b480d5f14df5e3341c"],
  ngslStats: [`${NGSL}NGSL_12_stats.csv`, "2098bab8955a120a9766c6282a51d7d578c6cb0a7d946600d2ffb73ba25a0b44"],
  nawl: [`${NGSL}NAWL_12_with_en_definitions.csv`, "2eca6b402b2cd17a8a0ce79f0ab6880bef8af2f4dbab38d045321cecaa3284a4"],
  hsk: [`https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/${HSK_COMMIT}/complete.min.json`, "52d8e64ba65a6db4a38ea34302c6de5df53cdb5145254b25edcbf93b80676434"],
  ...Object.fromEntries(
    [
      ["n5", "f89abc86b391c4f2b551bbf8910b0de6cd600973b3a9f8d98347513921929ebe"],
      ["n4", "0e835f40a8d2a1f191d7aa499076002756fa099b95634758376f43c73793e9f6"],
      ["n3", "ba071571d344e60b0e1fd11cd2e98a6aaa04515361653ca45147129460531297"],
      ["n2", "2d0f1ddd6222881cd9fc2ca701db74300af99b3f1f84d5ac3c18411c20f0c055"],
      ["n1", "120911636c019899552aa6d7bd64b036ecef4bedfe272a744f75735c46aae5cd"],
    ].map(([l, sha]) => [`jlpt-${l}`, [`https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/${JLPT_COMMIT}/src/${l}.csv`, sha]]),
  ),
};

/** A pinned file's bytes; a file pinned as null prints its hash to pin. */
async function get(name) {
  const [url, pin] = FILES[name];
  const res = await fetch(url, { headers: UA, redirect: "follow" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(bytes).digest("hex");
  if (pin && got !== pin) throw new Error(`${url}: sha256 ${got}, pinned ${pin}`);
  if (!pin) console.log(`  ${name}: sha256 ${got} (pin it)`);
  return bytes;
}

/** RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows.filter((r) => r.some((f) => f.trim()));
}

const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** The first sheet of an .xlsx as rows of strings (shared and inline strings, numbers). */
async function readXlsx(bytes) {
  const { BlobReader, TextWriter, ZipReader, configure } = await import("@zip.js/zip.js");
  configure({ useWebWorkers: false });
  const zip = new ZipReader(new BlobReader(new Blob([bytes])));
  const entries = Object.fromEntries((await zip.getEntries()).map((e) => [e.filename, e]));
  const read = (n) => entries[n].getData(new TextWriter());
  const shared = [...(await read("xl/sharedStrings.xml")).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    unescape([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
  );
  const sheet = await read("xl/worksheets/sheet1.xml");
  await zip.close();
  return [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) =>
    [...r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? "")?.[1] ?? "";
      return /t="s"/.test(c[1]) ? (shared[Number(v)] ?? "") : unescape(v);
    }),
  );
}

const clean = (s) => s.replace(/\s+/g, " ").trim();

const SPLIT = 1000;
const PART = 500;

/** A level of more than SPLIT words as parts of PART: "7–9 · 1–500", "7–9 · 501–1000", … */
export function splitLevels(levels) {
  return levels.flatMap((l) => {
    if (l.notes.length <= SPLIT) return [l];
    const parts = [];
    for (let i = 0; i < l.notes.length; i += PART) {
      const notes = l.notes.slice(i, i + PART);
      parts.push({ id: `${l.id}-${parts.length + 1}`, name: `${l.name} · ${i + 1}–${i + notes.length}`, notes });
    }
    return parts;
  });
}

/** Bands of `size` words: levels named by their ranks ("1–500"). */
function bands(words, size, prefix) {
  const out = [];
  for (let i = 0; i < words.length; i += size) {
    const part = words.slice(i, i + size);
    out.push({ id: `${prefix}-${out.length + 1}`, name: `${i + 1}–${i + part.length}`, notes: part });
  }
  return out;
}

async function ngsl() {
  const defs = new Map();
  for (const [word, def] of (await readXlsx(await get("ngslDefinitions"))).slice(1)) {
    if (word && def) defs.set(clean(word).toLowerCase(), clean(def));
  }
  const ranked = parseCsv((await get("ngslStats")).toString("utf8"))
    .slice(1)
    .map(([lemma, rank]) => ({ lemma: clean(lemma), rank: Number(rank) }))
    .filter((w) => w.lemma && Number.isFinite(w.rank))
    .sort((a, b) => a.rank - b.rank);
  const notes = ranked.map((w) => ({ t: w.lemma, m: defs.get(w.lemma.toLowerCase()) ?? "" })).filter((n) => n.m);
  console.log(`NGSL: ${ranked.length} ranked, ${notes.length} with a definition`);
  const nawl = parseCsv((await get("nawl")).toString("utf8"))
    .slice(1)
    .map(([word, def]) => ({ t: clean(word ?? ""), m: clean(def ?? "") }))
    .filter((n) => n.t && n.m);
  console.log(`NAWL: ${nawl.length} with a definition`);
  return [
    {
      list: "ngsl",
      name: "New General Service List (NGSL 1.2)",
      language: "en",
      licence: "cc-by-sa",
      source: "https://www.newgeneralservicelist.com/new-general-service-list",
      credit: "NGSL 1.2 by Browne, C., Culligan, B., and Phillips, J., CC BY-SA 4.0",
      levels: bands(notes, 500, "ngsl"),
    },
    {
      list: "nawl",
      name: "New Academic Word List (NAWL 1.2)",
      language: "en",
      licence: "cc-by-sa",
      source: "https://www.newgeneralservicelist.com/new-academic-word-list",
      credit: "NAWL 1.2 by Browne, C., Culligan, B., and Phillips, J., CC BY-SA 4.0",
      levels: bands(nawl, 480, "nawl"),
    },
  ];
}

async function hsk() {
  const words = JSON.parse((await get("hsk")).toString("utf8"));
  const level = (prefix, n) =>
    words
      .filter((w) => w.l.includes(`${prefix}${n}`))
      .sort((a, b) => (a.q ?? 1e9) - (b.q ?? 1e9))
      .map((w) => {
        const f = w.f[0];
        return { t: w.s, m: clean(`${f.i.y} · ${f.m.join("; ")}`) };
      })
      .filter((n) => n.t && n.m);
  const list = (id, name, prefix, levels) => ({
    list: id,
    name,
    language: "zh",
    licence: "cc-by-sa",
    source: "https://github.com/drkameleon/complete-hsk-vocabulary",
    credit: "drkameleon/complete-hsk-vocabulary (MIT); meanings from CC-CEDICT, CC BY-SA 4.0",
    levels: levels.map(([n, label]) => ({ id: `${id}-${n}`, name: label, notes: level(prefix, n) })),
  });
  return [
    list("hsk3", "HSK 3.0", "n", [[1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"], [6, "6"], [7, "7–9"]]),
    list("hsk2", "HSK 2.0", "o", [[1, "1"], [2, "2"], [3, "3"], [4, "4"], [5, "5"], [6, "6"]]),
  ];
}

async function jlpt() {
  const levels = [];
  for (const l of ["n5", "n4", "n3", "n2", "n1"]) {
    const rows = parseCsv((await get(`jlpt-${l}`)).toString("utf8"));
    const [head, ...body] = rows;
    const col = (name) => head.indexOf(name);
    const [e, r, m] = [col("expression"), col("reading"), col("meaning")];
    const seen = new Set();
    const notes = [];
    for (const row of body) {
      const term = clean(row[e] ?? "");
      const reading = clean(row[r] ?? "");
      const meaning = clean(row[m] ?? "");
      if (!term || !meaning || seen.has(term)) continue;
      seen.add(term);
      notes.push({ t: term, m: reading && reading !== term ? `${reading} · ${meaning}` : meaning });
    }
    levels.push({ id: `jlpt-${l}`, name: l.toUpperCase(), notes });
  }
  return [
    {
      list: "jlpt",
      name: "JLPT N5–N1",
      language: "ja",
      licence: "cc-by-sa",
      source: "https://github.com/jamsinclair/open-anki-jlpt-decks",
      credit: "Jonathan Waller's JLPT lists (tanos.co.uk), CC BY; meanings from JMdict/EDICT (EDRDG), CC BY-SA; jamsinclair/open-anki-jlpt-decks (MIT)",
      levels,
    },
  ];
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const index = [];
  for (const list of [...(await ngsl()), ...(await hsk()), ...(await jlpt())].map((l) => ({ ...l, levels: splitLevels(l.levels) }))) {
    for (const level of list.levels) {
      const terms = new Set(level.notes.map((n) => n.t));
      if (terms.size !== level.notes.length) throw new Error(`${level.id}: a term twice`);
    }
    writeFileSync(join(OUT, `${list.list}.json`), JSON.stringify(list) + "\n");
    const { levels, ...meta } = list;
    index.push({ ...meta, levels: levels.map((l) => ({ id: l.id, name: l.name, count: l.notes.length })) });
    console.log(`${list.list}: ${list.levels.map((l) => `${l.name} ${l.notes.length}`).join(", ")}`);
  }
  // What the catalogue and the word list's credit need, without the words.
  writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 1) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
