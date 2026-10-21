/**
 * ultimate-geography.mjs
 * Turns Ultimate Geography's CrowdAnki releases into the text-only decks
 * AnyLearn ships in its library (plans/261020-1535-beyond-english-learning-
 * areas, phase 5): app/data/decks/ultimate-geography-<lang>.json.
 *
 * Usage: node scripts/decks/ultimate-geography.mjs <EN.zip> <ES.zip> <PT.zip> <sources.csv>
 * (the v5.3 release assets, Ultimate_Geography_v5.3_<LANG>.zip, and the
 * repository's sources.csv at the v5.3 tag).
 *
 * Three decks per language. Capitals: each country with a capital gives two
 * cards, country → capital and capital → country; the capital's note, when
 * there is one, goes on the back. Flags and maps: the picture on the front,
 * the country (and its note) on the back.
 *
 * The text is public domain (the Unlicense). The pictures are not: each is
 * under the licence sources.csv gives it (CC BY-SA, CC BY, CC0 or public
 * domain), credited on its card by its source page and licence, and served
 * unchanged from the release (tool-runtime: ultimate-geography-media@5.3).
 * A picture sources.csv does not list is left out. Run again for a new
 * release, and move the media folder's version with it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BlobReader, TextWriter, ZipReader, configure } from "@zip.js/zip.js";

configure({ useWebWorkers: false });
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../app/data/decks");
const VERSION = "v5.3";

const MEDIA = "ultimate-geography-media@5.3";

const LANGS = {
  en: {
    name: "Ultimate Geography: capitals",
    toCapital: (c) => `${c}: capital?`,
    toCountry: (c) => `${c} is the capital of…?`,
    flags: "Ultimate Geography: flags",
    flag: "Whose flag is this?",
    maps: "Ultimate Geography: maps",
    map: "What is highlighted on this map?",
  },
  es: {
    name: "Ultimate Geography: capitales",
    toCapital: (c) => `${c}: ¿capital?`,
    toCountry: (c) => `¿${c} es la capital de…?`,
    flags: "Ultimate Geography: banderas",
    flag: "¿De quién es esta bandera?",
    maps: "Ultimate Geography: mapas",
    map: "¿Qué se resalta en este mapa?",
  },
  pt: {
    name: "Ultimate Geography: capitais",
    toCapital: (c) => `${c}: capital?`,
    toCountry: (c) => `${c} é a capital de…?`,
    flags: "Ultimate Geography: bandeiras",
    flag: "De quem é esta bandeira?",
    maps: "Ultimate Geography: mapas",
    map: "O que está destacado neste mapa?",
  },
};

/** sources.csv: File,Source,License,Modifications; no field holds a comma. */
function readSources(path) {
  const out = new Map();
  for (const line of readFileSync(path, "utf8").split("\n").slice(1)) {
    const [file, source, licence] = line.split(",");
    if (file && source?.startsWith("https://") && licence) out.set(file.trim(), { source: source.trim(), licence: licence.trim() });
  }
  return out;
}

/** The picture an <img> field names, with its credit; null when not credited. */
function picture(field, sources) {
  const file = /src="([^"]+)"/.exec(field ?? "")?.[1];
  const credit = file && sources.get(file);
  return credit ? { src: `${MEDIA}/${file}`, ...credit } : null;
}

function write(out) {
  writeFileSync(join(OUT, `${out.slug}.json`), JSON.stringify(out, null, 1) + "\n");
  console.log(`${out.slug}: ${out.cards.length} cards`);
}

/** A field's text: tags dropped, breaks kept as one space, entities decoded. */
function text(html) {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function deckJson(path) {
  const reader = new ZipReader(new BlobReader(new Blob([readFileSync(path)])));
  const entry = (await reader.getEntries()).find((e) => !e.directory && /(^|\/)deck\.json$/.test(e.filename));
  if (!entry) throw new Error(`${path}: no deck.json`);
  const json = JSON.parse(await entry.getData(new TextWriter()));
  await reader.close();
  return json;
}

const [en, es, pt, sourcesCsv] = process.argv.slice(2);
if (!sourcesCsv) throw new Error("usage: ultimate-geography.mjs <EN.zip> <ES.zip> <PT.zip> <sources.csv>");
const sources = readSources(sourcesCsv);
for (const [lang, path] of [["en", en], ["es", es], ["pt", pt]]) {
  const deck = await deckJson(path);
  const model = deck.note_models[0];
  const at = (name) => model.flds.findIndex((f) => f.name === name);
  // The English field names; a translated release keeps them.
  const [country, capital, capitalInfo] = [at("Country"), at("Capital"), at("Capital info")];
  const [countryInfo, flagField, mapField] = [at("Country info"), at("Flag"), at("Map")];
  if (country < 0 || capital < 0) throw new Error(`${path}: unexpected fields ${model.flds.map((f) => f.name)}`);
  const words = LANGS[lang];
  // One card per front: two countries with one capital share its card.
  const byFront = new Map();
  const add = (front, back) => {
    const had = byFront.get(front);
    byFront.set(front, had ? `${had} / ${back}` : back);
  };
  for (const n of deck.notes) {
    const c = text(n.fields[country] ?? "");
    const cap = text(n.fields[capital] ?? "");
    if (!c || !cap) continue;
    const info = capitalInfo >= 0 ? text(n.fields[capitalInfo] ?? "") : "";
    add(words.toCapital(c), info ? `${cap}. ${info}` : cap);
    add(words.toCountry(cap), c);
  }
  const cards = [...byFront].map(([front, back]) => ({ front, back }));
  const base = { language: lang, version: VERSION, source_url: "https://github.com/anki-geo/ultimate-geography" };
  write({ slug: `ultimate-geography-${lang}`, name: words.name, ...base, licence: "Public domain (the Unlicense)", cards });

  // One card per picture; the picture's country, and its note, on the back.
  const pictures = (field, front) => {
    const seen = new Set();
    const out = [];
    for (const n of deck.notes) {
      const c = text(n.fields[country] ?? "");
      const image = picture(n.fields[field], sources);
      if (!c || !image || seen.has(image.src)) continue;
      seen.add(image.src);
      const info = countryInfo >= 0 ? text(n.fields[countryInfo] ?? "") : "";
      out.push({ front, back: info ? `${c}. ${info}` : c, image });
    }
    return out;
  };
  const licence = "Text public domain (the Unlicense); pictures under CC BY-SA, CC BY, CC0 or public domain, credited on each card";
  write({ slug: `ultimate-geography-flags-${lang}`, name: words.flags, ...base, licence, cards: pictures(flagField, words.flag) });
  write({ slug: `ultimate-geography-maps-${lang}`, name: words.maps, ...base, licence, cards: pictures(mapField, words.map) });
}
