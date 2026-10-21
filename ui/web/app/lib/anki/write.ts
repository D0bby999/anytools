/**
 * anki/write.ts
 * Writes the vocabulary as an Anki deck (.apkg) in the browser (plans/
 * a private plan, phase 3): `collection.anki2` in Anki's schema
 * 11, which every Anki and AnkiDroid opens, holding one note type "AnyLearn
 * word" (Term, Meaning, Sentence, Source) and one deck "AnyLearn". Written
 * from Anki's documented schema and checked against genanki's (MIT); no code
 * of either is used.
 *
 * Schedules are not exported: Anki starts every card new. A note's guid is
 * derived from its language and term, so exporting again and importing into
 * Anki updates the notes rather than doubling them.
 */
import JSZip from "jszip";
import type { SqlJsStatic } from "~/tools/sql-playground/logic";

export type ExportWord = { term: string; lang: string; meaning: string; sentence: string; source: string };

/** Fixed ids, so a second export lands in the same note type and deck. */
export const MODEL_ID = 1792400000000;
export const DECK_ID = 1792400000001;

const FIELDS = ["Term", "Meaning", "Sentence", "Source"];

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null,
  ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null,
  models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null,
  usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null,
  flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null,
  mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null,
  ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null,
  odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null,
  ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
`;

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sha1Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const GUID_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** A stable guid for a word: its sha1, as ten base-62 digits. */
async function guidOf(lang: string, term: string): Promise<string> {
  let n = BigInt(`0x${(await sha1Hex(`anylearn:${lang}:${term.toLowerCase()}`)).slice(0, 16)}`);
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = GUID_DIGITS[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out;
}

function noteType(mod: number) {
  return {
    id: String(MODEL_ID),
    name: "AnyLearn word",
    type: 0,
    mod,
    usn: -1,
    sortf: 0,
    did: DECK_ID,
    tags: [],
    vers: [],
    req: [[0, "any", [0]]],
    flds: FIELDS.map((name, ord) => ({ name, ord, font: "Arial", size: 20, rtl: false, sticky: false, media: [] })),
    tmpls: [
      {
        name: "Recognition",
        ord: 0,
        qfmt: '<div class="term">{{Term}}</div>{{#Sentence}}<div class="sentence">{{Sentence}}</div>{{/Sentence}}',
        afmt: '{{FrontSide}}<hr id="answer"><div>{{Meaning}}</div>{{#Source}}<div class="source">{{Source}}</div>{{/Source}}',
        bqfmt: "",
        bafmt: "",
        bfont: "",
        bsize: 0,
        did: null,
      },
    ],
    css: ".card { font-family: system-ui, sans-serif; font-size: 20px; text-align: center; }\n.term { font-size: 28px; font-weight: 600; }\n.sentence, .source { margin-top: 12px; font-size: 16px; color: #666; }",
    latexPre:
      "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n",
    latexPost: "\\end{document}",
    latexsvg: false,
  };
}

function deck(id: number, name: string, mod: number) {
  return {
    id,
    name,
    conf: 1,
    desc: "",
    dyn: 0,
    collapsed: false,
    extendNew: 0,
    extendRev: 50,
    mod,
    usn: -1,
    lrnToday: [0, 0],
    newToday: [0, 0],
    revToday: [0, 0],
    timeToday: [0, 0],
  };
}

const DCONF = {
  "1": {
    id: 1,
    name: "Default",
    mod: 0,
    usn: 0,
    maxTaken: 60,
    autoplay: true,
    timer: 0,
    replayq: true,
    new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 7], order: 1, perDay: 20, separate: true },
    rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 200 },
    lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
  },
};

/** The words as an .apkg. */
export async function writeApkg(words: ExportWord[], SQL: SqlJsStatic, now = Date.now()): Promise<Uint8Array> {
  const db = new SQL.Database();
  try {
    db.run(SCHEMA);
    const secs = Math.floor(now / 1000);
    const conf = { nextPos: words.length + 1, estTimes: true, activeDecks: [DECK_ID], sortType: "noteFld", timeLim: 0,
      sortBackwards: false, addToCur: true, curDeck: DECK_ID, newSpread: 0, dueCounts: true, curModel: String(MODEL_ID),
      collapseTime: 1200 };
    db.run("INSERT INTO col VALUES (1, ?, ?, ?, 11, 0, 0, 0, ?, ?, ?, ?, '{}')", [
      secs - (secs % 86400),
      now,
      now,
      JSON.stringify(conf),
      JSON.stringify({ [MODEL_ID]: noteType(secs) }),
      JSON.stringify({ "1": deck(1, "Default", secs), [DECK_ID]: deck(DECK_ID, "AnyLearn", secs) }),
      JSON.stringify(DCONF),
    ]);
    for (const [i, w] of words.entries()) {
      const nid = now + i;
      const flds = [w.term, w.meaning, w.sentence, w.source].map(escape).join("\x1f");
      const csum = parseInt((await sha1Hex(w.term)).slice(0, 8), 16);
      db.run("INSERT INTO notes VALUES (?, ?, ?, ?, -1, '', ?, ?, ?, 0, '')", [
        nid,
        await guidOf(w.lang, w.term),
        MODEL_ID,
        secs,
        flds,
        w.term,
        csum,
      ]);
      db.run("INSERT INTO cards VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')", [
        now + words.length + i,
        nid,
        DECK_ID,
        secs,
        i + 1,
      ]);
    }
    const zip = new JSZip();
    zip.file("collection.anki2", db.export());
    zip.file("media", "{}");
    return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  } finally {
    db.close();
  }
}
