/**
 * vocab-types.ts
 * The vocabulary's API shapes and the small client-safe helpers the reader
 * and the review session share. Mirrors internal/vocab.
 */

export type VocabContext = {
  sentence: string;
  document_id?: string;
  document_title?: string;
  page?: number;
  chunk_id?: string;
  added_at: string;
};

export type VocabSource = { document_id: string; title: string; page?: number };

/**
 * production and listen exist only when the learner asked for them
 * (up-methods phase 3; plans/261020-1155-open-source-adds, phase 1).
 */
export type CardKind = "recognition" | "cloze" | "production" | "listen" | "write";

/**
 * A transcript line a listening card plays: page `page` of a YouTube video
 * (video_id) or an uploaded recording (no video_id), from start to end seconds.
 */
export type VocabClip = {
  document_id: string;
  page: number;
  video_id?: string;
  start: number;
  end: number;
  sentence: string;
};

/** A due card is a note's card, or a living book's flash card (phase 11). */
export type DueKind = CardKind | "flash" | "card";

export type CardSummary = {
  id: string;
  kind: CardKind;
  due_at: string;
  reps: number;
  lapses: number;
  suspended: boolean;
};

export type VocabNote = {
  id: string;
  term: string;
  lang: string;
  reading: string;
  pos: string;
  meaning: string;
  contexts: VocabContext[];
  source?: VocabSource;
  cards: CardSummary[];
  suspended: boolean;
  created_at: string;
  updated_at: string;
  /** up-methods phase 3: the decision about the word and its minimum record. */
  decision: Decision;
  record: Record<string, string>;
  task_impact: TaskImpact | "";
  decided_at: string;
  scenario: string;
  confusable: string;
  production: boolean;
  /** The listening card was asked for; clip is the line it would play. */
  listening: boolean;
  clip?: VocabClip;
  /** The writing card was asked for (a Chinese or Japanese word with characters). */
  writing: boolean;
};

export type DueCard = {
  id: string;
  /** Absent on a flash card, which has no note. */
  note_id?: string;
  kind: DueKind;
  due_at: string;
  reps: number;
  term: string;
  lang: string;
  reading: string;
  pos: string;
  meaning: string;
  context: string;
  cloze?: string;
  source?: VocabSource;
  /** Set on listening cards whose line can still be played. */
  clip?: VocabClip;
  /** Set on production cards only. */
  scenario?: string;
  confusable?: string;
  /** Set on flash cards only. */
  front?: string;
  back?: string;
  book?: { book_id: string; title: string; chapter_id: string };
  /** Set on a general deck's cards. */
  deck?: { id: string; name: string };
};

export type ReviewResult = {
  card_id: string;
  rating: Rating;
  matched?: boolean;
  due_at: string;
  reps: number;
  lapses: number;
  buried: number;
  replayed: boolean;
};

export type Term = { term: string; meaning: string; pos?: string };

export const RATINGS = ["again", "hard", "good", "easy"] as const;
export type Rating = (typeof RATINGS)[number];

/** The most cards one session serves; the server caps it too. */
export const SESSION_SIZE = 50;

/**
 * An answer folded for comparison: accents and case ignored, đ as d. The same
 * rule as the server's vocab.Fold, which records whether the answer matched.
 */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether a typed cloze answer is the term, exactly or accents ignored. */
export function clozeMatches(answer: string, term: string): boolean {
  const a = answer.trim();
  return a !== "" && (a === term || fold(a) === fold(term));
}

/** The rating a cloze answer suggests; the learner confirms it. */
export function suggestedRating(answer: string, term: string): Rating {
  return clozeMatches(answer, term) ? "good" : "again";
}

/**
 * The selection a stored vocab exchange was about: the blockquote lines of
 * readingapi's transcript message (`Vocabulary here (page 3):\n\n> …`).
 */
export function transcriptSelection(message: string): string {
  return message
    .split("\n")
    .filter((line) => line.startsWith(">"))
    .map((line) => line.replace(/^>\s?/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

// ─────────────────────────────── five decisions (up-methods phase 3)
// up's vocabulary chapter §3: not every unknown word deserves review. Mirrors
// internal/vocab/decisions.go; the server checks every one of these.

export const DECISIONS = ["skip", "infer", "lookup", "learn", "verify"] as const;
export type Decision = (typeof DECISIONS)[number];

/** Each decision's minimum record, in up's order. */
export const RECORD_FIELDS: Record<Decision, readonly string[]> = {
  skip: ["why"],
  infer: ["sense", "confidence"],
  lookup: ["source"],
  learn: ["sound", "collocation", "cue"],
  verify: ["definition", "scope", "owner"],
};

export const CONFIDENCES = ["low", "medium", "high"] as const;
export const TASK_IMPACTS = ["blocking", "important", "minor", "none"] as const;
export type TaskImpact = (typeof TASK_IMPACTS)[number];

/** Limits, as the server's. */
export const MAX_RECORD = 300;
export const MAX_SCENARIO = 300;
export const MAX_CONFUSABLE = 200;

/** A word to learn and a quick lookup keep a meaning: the current sense. */
export function needsMeaning(d: Decision): boolean {
  return d === "learn" || d === "lookup";
}

export function isDecision(v: unknown): v is Decision {
  return typeof v === "string" && (DECISIONS as readonly string[]).includes(v);
}

/** The learner's "learn" choices this week, and up's notice for that many. */
export type Week = { learning: number; notice?: "select" | "over" };

/** The record fields a decision form posts, as `record_<field>`. */
export function recordFromForm(form: FormData, decision: Decision): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of RECORD_FIELDS[decision]) out[f] = String(form.get(`record_${f}`) ?? "").trim();
  return out;
}

/**
 * A decision form's body for the API: the decision, its record, the task
 * impact, and the meaning. The meaning is left out where the learner did not
 * post one, so an inference saved before the suggestion was shown stays its
 * own.
 */
export function decisionBody(form: FormData): {
  decision: Decision;
  record: Record<string, string>;
  task_impact: string;
  meaning?: string;
} | null {
  const decision = form.get("decision");
  if (!isDecision(decision)) return null;
  const meaning = form.get("meaning");
  return {
    decision,
    record: recordFromForm(form, decision),
    task_impact: String(form.get("task_impact") ?? ""),
    ...(meaning === null ? {} : { meaning: String(meaning).trim() }),
  };
}

/** up's names for the decisions in the vocabulary card's §3 queue. */
const AUDIT_DECISION: Record<Decision, string> = {
  skip: "skip",
  infer: "infer",
  lookup: "quick lookup",
  learn: "learn",
  verify: "expert check",
};

/**
 * A note as a row of a vocabulary audit's §3 decision queue: word, task
 * impact, decision and the basis at the time (its record, joined). The row is
 * a copy; editing the note later does not change it.
 */
export function auditRow(note: VocabNote): { row: string; cells: Record<string, string> } {
  const basis = RECORD_FIELDS[note.decision]
    .map((f) => note.record[f])
    .filter((v): v is string => !!v)
    .join("; ")
    .slice(0, 500);
  const cells: Record<string, string> = { item: note.term, decision: AUDIT_DECISION[note.decision] };
  if (note.task_impact) cells.impact = note.task_impact;
  if (basis) cells.basis = basis;
  return { row: "", cells };
}

/** A Han character or a kana: a character with strokes to draw. */
export function drawable(char: string): boolean {
  return /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(char);
}

/** A word the writing card can be for, as vocab.Writable decides it: Chinese or Japanese, with characters. */
export function writable(term: string, lang: string): boolean {
  const primary = lang.split("-")[0];
  return (primary === "zh" || primary === "ja") && [...term].some(drawable);
}
