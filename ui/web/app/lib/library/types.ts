/**
 * library/types.ts
 * The Library's items (the private design notes, phase 1):
 * ready material from open sources, each with its licence and source, and
 * the one action that puts it where it is used. Shared by the server's
 * catalogue and the page.
 */

export const LIBRARY_KINDS = ["deck", "words", "questions", "course", "textbook", "book"] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

/**
 * The fields the Library files its material in, in the order the page shows
 * them (the private design notes): for any profession, not only
 * languages and programming. The URL keeps the name "subject".
 */
export const LIBRARY_SUBJECTS = [
  "business",
  "economics",
  "law",
  "health",
  "engineering",
  "programming",
  "science",
  "maths",
  "social",
  "humanities",
  "education",
  "media",
  "languages",
  "skills",
  "general",
  "fitness",
] as const;
export type LibrarySubject = (typeof LIBRARY_SUBJECTS)[number];

/** How hard an item is, where its source says (the private design notes). */
export const LIBRARY_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type LibraryLevel = (typeof LIBRARY_LEVELS)[number];

/** What finishing an item earns: a free certificate, a digital badge, or a certificate for a fee. */
export type LibraryCertificate = { kind: "free" | "badge" | "paid"; name?: string; priceMin?: number; priceMax?: number; currency?: "USD" };

/** A source's reviews: the rating out of 5, how many, and each criterion's average (1 to 5). */
export type LibraryRating = { value: number; count: number; scores?: Record<string, number> };

/** The orders the page offers; English always comes first. */
export const LIBRARY_SORTS = ["featured", "rating", "popular", "shortest", "newest"] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

/** Licences that let anyone copy and adapt, commercially too. */
export const REUSABLE_LICENCES = ["public-domain", "cc0", "cc-by", "cc-by-sa", "mit", "unlicense", "gfdl", "free-pictures"] as const;

/** A licence in kinds the page can say in the learner's language. */
export type Licence =
  | "public-domain"
  | "cc0"
  | "cc-by"
  | "cc-by-sa"
  | "mit"
  | "unlicense"
  | "free-pictures"
  | "gfdl"
  | "cc-by-nd"
  | "cc-by-nc"
  | "cc-by-nc-sa"
  | "cc-by-nc-nd"
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
  | { type: "open"; why: "nonCommercial" | "noLicence" | "bringFile" | "textbook" | "textbookNonCommercial" | "enrol" | "chooseLesson"; pdf?: string };

export type LibraryItem = {
  /** Unique in the catalogue, stable: an action names its item by it. */
  id: string;
  kind: LibraryKind;
  subject: LibrarySubject;
  /** The material's language (a BCP 47 code), or "mul" for many. */
  language: string;
  /** The language it is for learning, when it is (library/teaches.ts): a French textbook written in English teaches "fr". */
  teaches?: string;
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
  level?: LibraryLevel;
  /** About how many hours it takes, as its source says. */
  hours?: number;
  /** The year of its edition, term or copyright. */
  year?: number;
  certificate?: LibraryCertificate;
  rating?: LibraryRating;
  /** How often it is used, as its source counts: page views or downloads. */
  popularity?: { count: number; kind: "views" | "downloads" };
  /** Accessibility features its source names ("alternativeText", "tableOfContents"). */
  accessibility?: string[];
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
  /** Only material for learning this language. */
  teaches?: string;
  q: string;
  offset: number;
  sort?: LibrarySort;
  level?: LibraryLevel;
  /** "any" a certificate or badge, "free" a free one, "paid" one for a fee. */
  certificate?: "any" | "free" | "paid";
  video?: boolean;
  reusable?: boolean;
};

/** A source as the catalogue names it, with what pins its data. */
export type LibrarySource = { name: string; url: string; licence: string; pin: string; read: string };

/** Results shown at once; the page goes on with Next. */
export const LIBRARY_PAGE = 30;
