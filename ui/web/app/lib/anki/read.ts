/**
 * anki/read.ts
 * Reads an Anki deck in the browser (plans/261020-1155-open-source-adds,
 * phase 3; CrowdAnki and lazy reading: plans/261020-1535-beyond-english-
 * learning-areas, phase 5), so the server needs no SQLite and no zstd.
 * Written from the documented formats; no Anki code is used.
 *
 * Two kinds of file, both zips:
 *  - An .apkg, whose collection is a SQLite file in one of three forms,
 *    newest first: `collection.anki21b` (zstd-compressed, Anki 2.1.50+, note
 *    types in the `notetypes` and `fields` tables), `collection.anki21` and
 *    `collection.anki2` (note types as JSON in `col.models`). A new export
 *    also carries a legacy `collection.anki2` holding one "please update
 *    Anki" note, so the newest form present is the one read.
 *  - A CrowdAnki export, a folder with a `deck.json`: note models with their
 *    fields, and notes, in sub-decks too (Ultimate Geography ships so).
 *
 * The zip is read lazily (zip.js over the File): only its directory and the
 * one entry needed are read and inflated, never the media, so a 400 MB deck
 * with audio costs what its text costs. Media is not imported; how many
 * fields referred to it is counted so the page can say so.
 */
import { BlobReader, Uint8ArrayWriter, TextWriter, ZipReader, configure, type Entry, type FileEntry } from "@zip.js/zip.js";
import { decompress } from "fzstd";
import type { SqlJsDatabase, SqlJsStatic } from "~/tools/sql-playground/logic";

// One entry inflated on the page's thread: no worker to fetch or allow.
configure({ useWebWorkers: false });

export type AnkiNoteType = { id: string; name: string; fields: string[] };
export type AnkiNote = { typeId: string; fields: string[] };
export type AnkiDeck = {
  format: "anki21b" | "anki21" | "anki2" | "crowdanki";
  /** The deck's own name, when the file says it (CrowdAnki). */
  name?: string;
  types: AnkiNoteType[];
  notes: AnkiNote[];
  /** Fields that referred to an image or a sound, which are not imported. */
  media: number;
};

/** Why a file could not be read as a deck. */
export class AnkiError extends Error {
  constructor(readonly code: "not_a_deck" | "unreadable") {
    super(code);
  }
}

const COLLECTIONS = [
  ["collection.anki21b", "anki21b"],
  ["collection.anki21", "anki21"],
  ["collection.anki2", "anki2"],
] as const;

type Rows = Record<string, unknown>[];

function rows(db: SqlJsDatabase, sql: string): Rows {
  const [result] = db.exec(sql);
  if (!result) return [];
  return result.values.map((v) => Object.fromEntries(result.columns.map((c, i) => [c, v[i]])));
}

const isMedia = (f: string) => /<img\b|\[sound:/i.test(f);

/** Reads a deck's note types and notes from bytes (an .apkg or a CrowdAnki zip). */
export async function readApkg(data: ArrayBuffer | Uint8Array, SQL: SqlJsStatic): Promise<AnkiDeck> {
  return readDeck(new Blob([data as BlobPart]), SQL);
}

/** Reads a deck from a file, inflating only the entry it needs. */
export async function readDeck(file: Blob, SQL: SqlJsStatic): Promise<AnkiDeck> {
  let entries: Entry[];
  const reader = new ZipReader(new BlobReader(file));
  try {
    entries = await reader.getEntries();
  } catch {
    await reader.close().catch(() => undefined);
    throw new AnkiError("not_a_deck");
  }
  try {
    const files = entries.filter((e): e is FileEntry => !e.directory);
    const byName = new Map(files.map((e) => [e.filename, e]));
    const found = COLLECTIONS.find(([name]) => byName.has(name));
    if (found) return await readCollection(byName.get(found[0])!, found[1], SQL);
    const deckJson = files.find((e) => /(^|\/)deck\.json$/.test(e.filename));
    if (deckJson) return await readCrowdAnki(deckJson);
    throw new AnkiError("not_a_deck");
  } finally {
    await reader.close().catch(() => undefined);
  }
}

async function readCollection(entry: FileEntry, format: "anki21b" | "anki21" | "anki2", SQL: SqlJsStatic): Promise<AnkiDeck> {
  let db: SqlJsDatabase;
  try {
    let bytes: Uint8Array = await entry.getData(new Uint8ArrayWriter());
    if (format === "anki21b") bytes = decompress(bytes);
    db = new SQL.Database(bytes);
  } catch {
    throw new AnkiError("unreadable");
  }
  try {
    const hasNotetypes = rows(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'notetypes'").length > 0;
    let types: AnkiNoteType[];
    if (hasNotetypes) {
      const fields = new Map<string, string[]>();
      for (const r of rows(db, "SELECT ntid, name FROM fields ORDER BY ntid, ord")) {
        const id = String(r.ntid);
        fields.set(id, [...(fields.get(id) ?? []), String(r.name)]);
      }
      types = rows(db, "SELECT id, name FROM notetypes ORDER BY id").map((r) => ({
        id: String(r.id),
        name: String(r.name),
        fields: fields.get(String(r.id)) ?? [],
      }));
    } else {
      const [col] = rows(db, "SELECT models FROM col");
      const models = JSON.parse(String(col?.models ?? "{}")) as Record<
        string,
        { id: number | string; name: string; flds: { name: string; ord: number }[] }
      >;
      types = Object.values(models).map((m) => ({
        id: String(m.id),
        name: m.name,
        fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name),
      }));
    }
    let media = 0;
    const notes = rows(db, "SELECT mid, flds FROM notes ORDER BY id").map((r) => {
      const fields = String(r.flds).split("\x1f");
      media += fields.filter(isMedia).length;
      return { typeId: String(r.mid), fields };
    });
    return { format, types: types.filter((t) => notes.some((n) => n.typeId === t.id)), notes, media };
  } catch (e) {
    if (e instanceof AnkiError) throw e;
    throw new AnkiError("unreadable");
  } finally {
    db.close();
  }
}

type CrowdDeck = {
  name?: string;
  note_models?: { crowdanki_uuid: string; name: string; flds: { name: string; ord: number }[] }[];
  notes?: { note_model_uuid: string; fields: string[] }[];
  children?: CrowdDeck[];
};

/** A CrowdAnki deck.json: its models, and its notes and its sub-decks', in order. */
async function readCrowdAnki(entry: FileEntry): Promise<AnkiDeck> {
  let deck: CrowdDeck;
  try {
    deck = JSON.parse(await entry.getData(new TextWriter())) as CrowdDeck;
  } catch {
    throw new AnkiError("unreadable");
  }
  const types: AnkiNoteType[] = [];
  const notes: AnkiNote[] = [];
  let media = 0;
  const walk = (d: CrowdDeck) => {
    for (const m of d.note_models ?? []) {
      if (!types.some((t) => t.id === m.crowdanki_uuid)) {
        types.push({ id: m.crowdanki_uuid, name: m.name, fields: [...m.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name) });
      }
    }
    for (const n of d.notes ?? []) {
      if (!Array.isArray(n.fields)) continue;
      media += n.fields.filter(isMedia).length;
      notes.push({ typeId: n.note_model_uuid, fields: n.fields.map(String) });
    }
    for (const c of d.children ?? []) walk(c);
  };
  walk(deck);
  if (types.length === 0) throw new AnkiError("unreadable");
  return { format: "crowdanki", name: deck.name, types: types.filter((t) => notes.some((n) => n.typeId === t.id)), notes, media };
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** Decodes the named entities the table above lacks (&eacute;), where a DOM exists. */
function decodeNamed(s: string): string {
  if (!/&[a-z]+;/i.test(s) || typeof DOMParser === "undefined") return s;
  return new DOMParser().parseFromString(`<!doctype html><body>${s.replace(/</g, "&lt;")}`, "text/html").body.textContent ?? s;
}

/**
 * A field as plain text: sounds and images dropped, a cloze's answer kept
 * ({{c1::answer::hint}} is "answer"), line breaks as spaces, tags removed and
 * entities decoded.
 */
export function fieldText(html: string): string {
  return html
    .replace(/\[sound:[^\]]*\]/gi, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/\{\{c\d+::(.*?)(?:::.*?)?\}\}/g, "$1")
    .replace(/<br\s*\/?>|<\/(?:div|p|li)>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        // A code point outside Unicode is left as written; fromCodePoint would throw.
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? decodeNamed(m);
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** Which field of one note type is the term, the meaning and the sentence (-1: none). */
export type FieldMap = { typeId: string; term: number; meaning: number; sentence: number };

/** A first guess at a note type's mapping, from its field names. */
export function guessMap(type: AnkiNoteType): FieldMap {
  const find = (re: RegExp) => type.fields.findIndex((f) => re.test(f));
  let term = find(/^(front|word|term|expression|vocab\w*|từ\w*|palabra|palavra)$/i);
  if (term < 0) term = 0;
  let meaning = find(/^(back|meaning|definition|translation|gloss|nghĩa|significado|tradução|traducción)$/i);
  if (meaning < 0 || meaning === term) meaning = type.fields.length > 1 ? (term === 0 ? 1 : 0) : -1;
  const sentence = find(/sentence|example|context|câu|ví dụ|frase|ejemplo|exemplo/i);
  return { typeId: type.id, term, meaning, sentence: sentence === term || sentence === meaning ? -1 : sentence };
}

/** The server's limits, so the preview counts what it will refuse. */
export const MAX_TERM = 80;
export const MAX_MEANING = 1000;

export type MappedNote = { term: string; meaning: string; sentence: string };

/**
 * The deck's notes as words, by each note type's mapping; a note type with no
 * mapping is left out. `skipped` counts the words the server would refuse
 * (no term, a term too long to be one, no meaning, a meaning too long).
 */
export function mapNotes(deck: AnkiDeck, maps: FieldMap[]): { notes: MappedNote[]; skipped: number } {
  const byType = new Map(maps.map((m) => [m.typeId, m]));
  const notes: MappedNote[] = [];
  let skipped = 0;
  for (const n of deck.notes) {
    const m = byType.get(n.typeId);
    if (!m) continue;
    const at = (i: number) => (i >= 0 ? fieldText(n.fields[i] ?? "") : "");
    const word = { term: at(m.term), meaning: at(m.meaning), sentence: at(m.sentence) };
    if (!word.term || [...word.term].length > MAX_TERM || !word.meaning || [...word.meaning].length > MAX_MEANING) {
      skipped++;
      continue;
    }
    notes.push(word);
  }
  return { notes, skipped };
}

/** A note type's fields as a general card: which is the front, which the back, and one more for the back. */
export type CardMap = { typeId: string; front: number; back: number; extra: number };

/** The first field as the front and the second as the back: Anki's Basic. */
export function guessCardMap(type: AnkiNoteType): CardMap {
  return { typeId: type.id, front: 0, back: type.fields.length > 1 ? 1 : 0, extra: -1 };
}

/** A general card's limits, as the API checks them (vocab.MaxDeckFront, MaxDeckBack). */
export const MAX_FRONT = 500;
export const MAX_BACK = 2000;

/** The notes as cards; a note with an empty or too long face is skipped and counted. */
export function mapCards(deck: AnkiDeck, maps: CardMap[]): { cards: { front: string; back: string }[]; skipped: number } {
  const byType = new Map(maps.map((m) => [m.typeId, m]));
  const cards: { front: string; back: string }[] = [];
  let skipped = 0;
  for (const n of deck.notes) {
    const m = byType.get(n.typeId);
    if (!m) continue;
    const front = fieldText(n.fields[m.front] ?? "");
    const back = [m.back, m.extra]
      .filter((i) => i >= 0 && i !== m.front)
      .map((i) => fieldText(n.fields[i] ?? ""))
      .filter(Boolean)
      .join("\n");
    if (!front || !back || front.length > MAX_FRONT || back.length > MAX_BACK) {
      skipped++;
      continue;
    }
    cards.push({ front, back });
  }
  return { cards, skipped };
}
