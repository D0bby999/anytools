/**
 * library/types.ts
 * The Library's items (the private design notes, phase 1):
 * ready material from open sources, each with its licence and source, and
 * the one action that puts it where it is used. Shared by the server's
 * catalogue and the page.
 */

export const LIBRARY_KINDS = ["deck", "words", "questions", "course", "textbook", "book"] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

export const LIBRARY_SUBJECTS = ["languages", "maths", "science", "programming", "geography", "general", "humanities", "fitness"] as const;
export type LibrarySubject = (typeof LIBRARY_SUBJECTS)[number];

/** A licence in kinds the page can say in the learner's language. */
export type Licence =
  | "public-domain"
  | "cc0"
  | "cc-by"
  | "cc-by-sa"
  | "mit"
  | "unlicense"
  | "free-pictures"
  | "cc-by-nc"
  | "cc-by-nc-sa"
  /** A link in a list: the work is its owner's, free to read or watch at its source. */
  | "free-access"
  | "none";

/** What a tap does: each puts the item where it is used, or opens it at its source. */
export type LibraryAction =
  /** A bundled deck: added to Decks. */
  | { type: "deck"; slug: string }
  /** A web page, a YouTube video or playlist, a book's page: the knowledge base's link import. */
  | { type: "link"; url: string }
  /** A word list's levels: added to the language's vocabulary (phase 4). */
  | { type: "words"; list: string; levels: { id: string; name: string; count: number }[] }
  /** A question set's parts: added to a knowledge base's Quiz (phase 5). */
  | { type: "set"; set: string; parts: { id: string; name: string; count: number }[] }
  /** A page of AnyLearn's own. */
  | { type: "page"; to: string }
  /** Nothing to add: opened at its source, for the reason given. */
  | { type: "open"; why: "nonCommercial" | "noLicence" | "bringFile" | "textbook"; pdf?: string };

export type LibraryItem = {
  /** Unique in the catalogue, stable: an action names its item by it. */
  id: string;
  kind: LibraryKind;
  subject: LibrarySubject;
  /** The material's language (a BCP 47 code), or "mul" for many. */
  language: string;
  name: string;
  /** A translation key for a name AnyLearn wrote ("ns:key"), used instead of name. */
  nameKey?: string;
  /** One line on what it is, as the source says it. */
  about?: string;
  /** A translation key for a line AnyLearn wrote ("ns:key"), used instead of about. */
  aboutKey?: string;
  /** The source's own heading for it ("Python", "Mathematics"). */
  section?: string;
  author?: string;
  /** How much there is, counted in unit. */
  count?: number;
  unit?: "cards" | "words" | "questions" | "courses" | "books" | "exercises";
  /** A video or a playlist. */
  video?: boolean;
  licence: Licence;
  /** Where it comes from: the project that made or lists it. */
  source: { name: string; url: string };
  /** The library key of the credit its list asks for, shown under the results it is in. */
  credit?: string;
  /** A credit in the source's own words, shown with the item. */
  creditText?: string;
  /** The item itself, to open in a new tab. */
  url: string;
  action: LibraryAction;
};

/** The page's filters, as they are in the URL. */
export type LibraryFilter = {
  kind?: LibraryKind;
  subject?: LibrarySubject;
  /** "" is the learner's languages (the interface's and English); "all" is every language. */
  lang: string;
  q: string;
  offset: number;
};

/** Results shown at once; the page goes on with Next. */
export const LIBRARY_PAGE = 30;
