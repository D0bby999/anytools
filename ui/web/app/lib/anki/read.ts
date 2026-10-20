/**
 * anki/read.ts
 * Reads an Anki deck (.apkg) in the browser (plans/261020-1155-open-source-
 * adds, phase 3), so the server needs no SQLite and no zstd. Written from
 * Anki's documented file format; no Anki code is used.
 *
 * An .apkg is a zip. Its collection is a SQLite file in one of three forms,
 * newest first: `collection.anki21b` (zstd-compressed, Anki 2.1.50+, note
 * types in the `notetypes` and `fields` tables), `collection.anki21` and
 * `collection.anki2` (note types as JSON in `col.models`). A new export also
 * carries a legacy `collection.anki2` holding one "please update Anki" note,
 * so the newest form present is the one read.
 *
 * Media (images, sounds) is not imported; how many references were dropped is
 * counted so the page can say so.
 */
import JSZip from "jszip";
import { decompress } from "fzstd";
import type { SqlJsDatabase, SqlJsStatic } from "~/tools/sql-playground/logic";

export type AnkiNoteType = { id: string; name: string; fields: string[] };
export type AnkiNote = { typeId: string; fields: string[] };
export type AnkiDeck = {
  format: "anki21b" | "anki21" | "anki2";
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

/** Reads a deck's note types and notes. */
export async function readApkg(data: ArrayBuffer | Uint8Array, SQL: SqlJsStatic): Promise<AnkiDeck> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new AnkiError("not_a_deck");
  }
  const found = COLLECTIONS.find(([name]) => zip.file(name));
  if (!found) throw new AnkiError("not_a_deck");
  const [name, format] = found;
  let db: SqlJsDatabase;
  try {
    let bytes = await zip.file(name)!.async("uint8array");
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
      media += fields.filter((f) => /<img\b|\[sound:/i.test(f)).length;
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
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
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
