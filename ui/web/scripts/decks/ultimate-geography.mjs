/**
 * ultimate-geography.mjs
 * Turns Ultimate Geography's CrowdAnki releases into the text-only decks
 * AnyLearn ships in its library (plans/261020-1535-beyond-english-learning-
 * areas, phase 5): app/data/decks/ultimate-geography-<lang>.json.
 *
 * Usage: node scripts/decks/ultimate-geography.mjs <EN.zip> <ES.zip> <PT.zip>
 * (the v5.3 release assets, Ultimate_Geography_v5.3_<LANG>.zip).
 *
 * The deck is public domain (the Unlicense) except its images, which are
 * left out: flags and maps are not read. Each country with a capital gives
 * two cards, country → capital and capital → country; the capital's note,
 * when there is one, goes on the back. Run again for a new release.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BlobReader, TextWriter, ZipReader, configure } from "@zip.js/zip.js";

configure({ useWebWorkers: false });
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../app/data/decks");
const VERSION = "v5.3";

const LANGS = {
  en: { name: "Ultimate Geography: capitals", toCapital: (c) => `${c}: capital?`, toCountry: (c) => `${c} is the capital of…?` },
  es: { name: "Ultimate Geography: capitales", toCapital: (c) => `${c}: ¿capital?`, toCountry: (c) => `¿${c} es la capital de…?` },
  pt: { name: "Ultimate Geography: capitais", toCapital: (c) => `${c}: capital?`, toCountry: (c) => `${c} é a capital de…?` },
};

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

const [en, es, pt] = process.argv.slice(2);
if (!pt) throw new Error("usage: ultimate-geography.mjs <EN.zip> <ES.zip> <PT.zip>");
for (const [lang, path] of [["en", en], ["es", es], ["pt", pt]]) {
  const deck = await deckJson(path);
  const model = deck.note_models[0];
  const at = (name) => model.flds.findIndex((f) => f.name === name);
  // The English field names; a translated release keeps them.
  const [country, capital, capitalInfo] = [at("Country"), at("Capital"), at("Capital info")];
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
  const out = {
    slug: `ultimate-geography-${lang}`,
    name: words.name,
    language: lang,
    version: VERSION,
    source_url: "https://github.com/anki-geo/ultimate-geography",
    licence: "Public domain (the Unlicense), images excluded and not included here",
    cards,
  };
  writeFileSync(join(OUT, `${out.slug}.json`), JSON.stringify(out, null, 1) + "\n");
  console.log(`${out.slug}: ${cards.length} cards from ${deck.notes.length} notes`);
}
