/**
 * anki-deck.test.ts
 * Anki decks in and out (the private design notes, phase 3): an
 * .apkg written by anki/write.ts reads back the same words through
 * anki/read.ts; a new-format deck (zstd-compressed collection.anki21b, with
 * the legacy "please update" stub beside it) is read from its newest
 * collection; fields become plain text; and the mapping counts what the
 * server would refuse. anki21b-synthetic.apkg is built with sqlite3 and the
 * zstd CLI in Anki's table layout (HTML, a cloze, media, an empty word);
 * anki21b-from-anki.apkg was exported by Anki's own library.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { loadSqlJs, type SqlJsStatic } from "~/tools/sql-playground/logic";
import { AnkiError, fieldText, guessMap, mapNotes, readApkg } from "~/lib/anki/read";
import { DECK_ID, MODEL_ID, writeApkg, type ExportWord } from "~/lib/anki/write";

let SQL: SqlJsStatic;
beforeAll(async () => {
  SQL = await loadSqlJs();
});

const words: ExportWord[] = [
  { term: "equilibrium", lang: "en", meaning: "a balanced state", sentence: "The market reached equilibrium.", source: "Economics.pdf" },
  { term: "điều chỉnh", lang: "vi", meaning: "adjust <a & b>", sentence: "", source: "" },
];

describe("an AnyLearn export", () => {
  it("reads back the same words, in an Anki schema 11 collection", async () => {
    const apkg = await writeApkg(words, SQL, 1_792_400_000_000);
    const zip = await JSZip.loadAsync(apkg);
    expect(Object.keys(zip.files).sort()).toEqual(["collection.anki2", "media"]);

    const deck = await readApkg(apkg, SQL);
    expect(deck.format).toBe("anki2");
    expect(deck.types).toEqual([{ id: String(MODEL_ID), name: "AnyLearn word", fields: ["Term", "Meaning", "Sentence", "Source"] }]);
    const { notes, skipped } = mapNotes(deck, [guessMap(deck.types[0]!)]);
    expect(skipped).toBe(0);
    expect(notes).toEqual([
      { term: "equilibrium", meaning: "a balanced state", sentence: "The market reached equilibrium." },
      { term: "điều chỉnh", meaning: "adjust <a & b>", sentence: "" },
    ]);

    // One new card per note, in the AnyLearn deck, in order; a stable guid.
    const db = new SQL.Database(await zip.file("collection.anki2")!.async("uint8array"));
    const cards = db.exec("SELECT did, queue, type, due FROM cards ORDER BY due")[0]!.values;
    expect(cards).toEqual([
      [DECK_ID, 0, 0, 1],
      [DECK_ID, 0, 0, 2],
    ]);
    const [ver] = db.exec("SELECT ver FROM col")[0]!.values;
    expect(ver).toEqual([11]);
    const guids = db.exec("SELECT guid FROM notes ORDER BY id")[0]!.values.flat();
    db.close();
    const again = new SQL.Database(await (await JSZip.loadAsync(await writeApkg(words, SQL, 1_792_500_000_000))).file("collection.anki2")!.async("uint8array"));
    expect(again.exec("SELECT guid FROM notes ORDER BY id")[0]!.values.flat()).toEqual(guids);
    again.close();
  });
});

describe("a deck from a recent Anki", () => {
  it("is read from collection.anki21b, not the legacy stub beside it", async () => {
    const file = readFileSync(join(__dirname, "fixtures", "anki21b-synthetic.apkg"));
    const deck = await readApkg(new Uint8Array(file), SQL);
    expect(deck.format).toBe("anki21b");
    expect(deck.types.map((t) => t.name)).toEqual(["Vocab (front/back/example)", "Cloze"]);
    expect(deck.media).toBe(2);

    const vocabType = deck.types[0]!;
    expect(guessMap(vocabType)).toEqual({ typeId: vocabType.id, term: 0, meaning: 1, sentence: 2 });
    const { notes, skipped } = mapNotes(deck, [guessMap(vocabType)]);
    expect(notes).toEqual([
      { term: "ubiquitous", meaning: "present everywhere", sentence: "Phones are ubiquitous now." },
      { term: "ephemeral", meaning: "lasting a very short time fleeting", sentence: "Fame is ephemeral." },
    ]);
    expect(skipped).toBe(1);
  });

  it("reads a deck that Anki itself exported in its newest format", async () => {
    // Made by the anki Python package (25.x): Basic and Cloze notes, exported
    // with legacy=False, so collection.anki21b beside the "please update" stub.
    const file = readFileSync(join(__dirname, "fixtures", "anki21b-from-anki.apkg"));
    const deck = await readApkg(new Uint8Array(file), SQL);
    expect(deck.format).toBe("anki21b");
    const basic = deck.types.find((t) => t.name === "Basic")!;
    expect(basic.fields).toEqual(["Front", "Back"]);
    const { notes } = mapNotes(deck, [guessMap(basic)]);
    expect(notes).toEqual([
      { term: "serendipity", meaning: "finding good things by chance", sentence: "" },
      { term: "naïve", meaning: "innocent and trusting", sentence: "" },
      { term: "café", meaning: "a small restaurant", sentence: "" },
    ]);
  });

  it("refuses a file that is not a deck", async () => {
    await expect(readApkg(new TextEncoder().encode("not a zip"), SQL)).rejects.toBeInstanceOf(AnkiError);
    const zip = new JSZip();
    zip.file("notes.txt", "hello");
    await expect(readApkg(await zip.generateAsync({ type: "uint8array" }), SQL)).rejects.toMatchObject({ code: "not_a_deck" });
  });
});

describe("a field as text", () => {
  it("drops media and markup and keeps a cloze's answer", () => {
    expect(fieldText("The {{c1::mitochondria::organelle}} is<br>the <b>powerhouse</b>.")).toBe("The mitochondria is the powerhouse.");
    expect(fieldText("[sound:a.mp3]word <img src=x.png>")).toBe("word");
    expect(fieldText("caf&eacute; &amp; &#x1F600; &#233; &lt;b&gt;")).toBe("café & 😀 é <b>");
  });
});
