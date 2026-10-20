/**
 * highlights.test.ts
 * Kindle and KOReader highlights (plans/261020-1155-open-source-adds, phase
 * 5): My Clippings.txt in the Kindle's own words (English, Spanish,
 * Portuguese), bookmarks dropped, notes on their highlights, an edited
 * highlight kept once, BOM and CRLF, an unknown kind kept; KOReader's JSON;
 * and each book as Markdown with a file name that becomes its title.
 */
import { describe, expect, it } from "vitest";
import { bookFileName, bookMarkdown, parseClippings, parseHighlights, parseKOReader } from "~/lib/highlights";

const EN = [
  "\uFEFFThinking, Fast and Slow (Daniel Kahneman)",
  "- Your Highlight on page 20 | Location 300-302 | Added on Monday, March 4, 2024 9:12:01 PM",
  "",
  "A reliable way to make people believe in falsehoods is frequent repetition",
  "==========",
  "Thinking, Fast and Slow (Daniel Kahneman)",
  "- Your Highlight on page 20 | Location 300-305 | Added on Monday, March 4, 2024 9:13:00 PM",
  "",
  "A reliable way to make people believe in falsehoods is frequent repetition, because familiarity is not easily distinguished from truth.",
  "==========",
  "Thinking, Fast and Slow (Daniel Kahneman)",
  "- Your Note on page 20 | Location 305 | Added on Monday, March 4, 2024 9:14:00 PM",
  "",
  "This is why slogans work.",
  "==========",
  "Thinking, Fast and Slow (Daniel Kahneman)",
  "- Your Bookmark on page 30 | Location 450 | Added on Monday, March 4, 2024 9:20:00 PM",
  "",
  "",
  "==========",
  "The Old Man and the Sea (Ernest Hemingway)",
  "- Highlight Loc. 120-24  | Added on Tuesday, May 1, 2012, 08:00 AM",
  "",
  "He was an old man who fished alone in a skiff in the Gulf Stream.",
  "==========",
  "The Old Man and the Sea (Ernest Hemingway)",
  "- Something new the Kindle says on page 9 | Location 200 | Added on Tuesday, May 1, 2012",
  "",
  "A line the parser has not seen the kind of.",
  "==========",
  "",
].join("\r\n");

describe("My Clippings.txt", () => {
  it("groups by book, keeps an edited highlight once and puts the note on it", () => {
    const [kahneman, hemingway] = parseClippings(EN);
    expect(kahneman).toEqual({
      title: "Thinking, Fast and Slow",
      author: "Daniel Kahneman",
      highlights: [
        {
          text: "A reliable way to make people believe in falsehoods is frequent repetition, because familiarity is not easily distinguished from truth.",
          note: "This is why slogans work.",
          page: "20",
          location: "300-305",
          added: "Added on Monday, March 4, 2024 9:13:00 PM",
        },
      ],
      notes: [],
    });
    // The old "Loc. 120-24" form, and a kind not recognised: kept as a highlight.
    expect(hemingway!.highlights.map((h) => [h.location, h.text.slice(0, 12)])).toEqual([
      ["120-24", "He was an ol"],
      ["200", "A line the p"],
    ]);
  });

  it("reads a Spanish and a Portuguese Kindle", () => {
    const es = parseClippings(
      [
        "Cien años de soledad (Gabriel García Márquez)",
        "- Tu subrayado en la página 9 | posición 120-121 | Añadido el lunes, 4 de marzo de 2024 21:12:01",
        "",
        "Muchos años después, frente al pelotón de fusilamiento…",
        "==========",
        "Cien años de soledad (Gabriel García Márquez)",
        "- Tu nota en la página 9 | posición 121 | Añadido el lunes, 4 de marzo de 2024 21:13:00",
        "",
        "El comienzo más famoso.",
        "==========",
        "Cien años de soledad (Gabriel García Márquez)",
        "- Tu marcador en la página 10 | posición 130 | Añadido el lunes",
        "",
        "",
        "==========",
      ].join("\n"),
    );
    expect(es[0]!.highlights).toEqual([
      {
        text: "Muchos años después, frente al pelotón de fusilamiento…",
        note: "El comienzo más famoso.",
        page: "9",
        location: "120-121",
        added: "Añadido el lunes, 4 de marzo de 2024 21:12:01",
      },
    ]);
    const pt = parseClippings(
      [
        "Dom Casmurro (Machado de Assis)",
        "- Seu destaque na página 3 | posição 40-42 | Adicionado: segunda-feira, 4 de março de 2024 21:12:01",
        "",
        "Uma noite destas, vindo da cidade para o Engenho Novo…",
        "==========",
        "Dom Casmurro (Machado de Assis)",
        "- Sua nota na posição 90 | Adicionado: segunda-feira",
        "",
        "Uma nota solta.",
        "==========",
      ].join("\n"),
    );
    expect(pt[0]!.highlights[0]!.location).toBe("40-42");
    expect(pt[0]!.notes).toEqual([{ text: "Uma nota solta.", location: "90", added: "Adicionado: segunda-feira" }]);
  });
});

describe("KOReader's JSON", () => {
  it("reads one book or several, chapters and notes", () => {
    const one = {
      title: "Meditations",
      author: "Marcus Aurelius",
      entries: [
        { chapter: "Book II", page: 12, text: "Begin the morning by saying to thyself…", note: "Daily", time: 1700000000 },
        { chapter: "Book II", page: 13, text: "  " },
      ],
    };
    expect(parseKOReader(JSON.stringify(one))).toEqual([
      {
        title: "Meditations",
        author: "Marcus Aurelius",
        highlights: [{ text: "Begin the morning by saying to thyself…", note: "Daily", page: "12", chapter: "Book II", added: "2023-11-14" }],
        notes: [],
      },
    ]);
    expect(parseHighlights(JSON.stringify([one, { ...one, title: "Again" }])).map((b) => b.title)).toEqual(["Meditations", "Again"]);
    expect(parseKOReader("not json")).toEqual([]);
  });
});

describe("a book as a document", () => {
  const labels = { by: "by", page: "Page", location: "Location", note: "Note", notes: "Notes" };
  it("quotes each highlight with where it is and its note", () => {
    const [book] = parseClippings(EN);
    expect(bookMarkdown(book!, labels)).toBe(
      [
        "# Thinking, Fast and Slow",
        "",
        "by Daniel Kahneman",
        "",
        "> A reliable way to make people believe in falsehoods is frequent repetition, because familiarity is not easily distinguished from truth.",
        "",
        "*Page 20 · Location 300-305 · Added on Monday, March 4, 2024 9:13:00 PM*",
        "",
        "**Note:** This is why slogans work.",
        "",
      ].join("\n"),
    );
    expect(bookFileName(book!)).toBe("Thinking, Fast and Slow.md");
    expect(bookFileName({ title: 'a/b: "c"?', author: "", highlights: [], notes: [] })).toBe("a b c.md");
  });
});
