/**
 * deck-library.ts
 * The ready decks AnyLearn offers (plans/261020-1535-beyond-english-learning-
 * areas, phase 5; ux/05-decks.md). A deck AnyLearn may ship (public domain,
 * CC0, CC BY) is bundled as text and added in one tap; any other is linked,
 * and the learner brings its file to the importer. Each entry says its
 * licence before anything is fetched.
 */

export type LicenceKind = "public-domain" | "cc-by" | "cc-by-nc" | "none";

export type LibraryDeck = {
  /** Bundled decks: the file in app/data/decks; linked decks: an id. */
  slug: string;
  subject: "geography" | "languages" | "programming";
  name: string;
  /** What it covers, in English; the page's own copy says it in the learner's language. */
  about: string;
  language: string;
  cards?: number;
  licence: LicenceKind;
  sourceUrl: string;
  /** Bundled: added in one tap. Otherwise the learner gets the file from the source. */
  bundled: boolean;
};

export const LIBRARY: LibraryDeck[] = [
  // Card counts as scripts/decks/ultimate-geography.mjs wrote them.
  ...(
    [
      ["en", 436],
      ["es", 436],
      ["pt", 435],
    ] as const
  ).map(
    ([lang, cards]): LibraryDeck => ({
      slug: `ultimate-geography-${lang}`,
      subject: "geography",
      name: "Ultimate Geography",
      about: "ultimateGeography",
      language: lang,
      cards,
      licence: "public-domain",
      sourceUrl: "https://github.com/anki-geo/ultimate-geography",
      bundled: true,
    }),
  ),
  {
    slug: "jlpt-decks",
    subject: "languages",
    name: "JLPT N5–N1",
    about: "jlpt",
    language: "ja",
    licence: "cc-by-nc",
    sourceUrl: "https://github.com/5mdld/anki-jlpt-decks",
    bundled: false,
  },
  {
    slug: "anki-french",
    subject: "languages",
    name: "French vocabulary (anki_french)",
    about: "french",
    language: "fr",
    licence: "cc-by-nc",
    sourceUrl: "https://github.com/jacbz/anki_french",
    bundled: false,
  },
  {
    slug: "coding-flashcards",
    subject: "programming",
    name: "Coding Flashcards",
    about: "coding",
    language: "en",
    licence: "none",
    sourceUrl: "https://github.com/ad-si/Coding-Flashcards",
    bundled: false,
  },
];

/** The source a library deck is recorded with on the learner's deck. */
export const librarySource = (slug: string) => `library:${slug}`;

/** The licence's words for the record, in English: the page translates by kind. */
export const LICENCE_TEXT: Record<LicenceKind, string> = {
  "public-domain": "Public domain",
  "cc-by": "CC BY",
  "cc-by-nc": "CC BY-NC (non-commercial)",
  none: "No licence given",
};
