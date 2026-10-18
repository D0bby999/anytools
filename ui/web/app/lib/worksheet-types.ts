/**
 * worksheet-types.ts
 * up's worksheets, as the API serves them (internal/learning/worksheet). The
 * kinds are data from GET /v1/worksheet-kinds: the app renders whatever it is
 * given and holds no kind of its own.
 */

export type WorksheetGroup = "language" | "projects" | "life";

export type FieldType =
  | "text"
  | "long"
  | "choice"
  | "multi"
  | "score"
  | "yesno"
  | "date"
  | "check"
  | "table"
  | "label"
  | "audio";

export type WorksheetRow = {
  key: string;
  label: string;
  /** A section of another kind this row practises (an experiment's day 5 → the shadowing ladder). */
  see?: { kind: string; section: string };
};

/** Shows a field only while a yes/no of its section (or one cell of a table there) holds `equals`. */
export type ShowWhen = { field: string; row?: string; column?: string; equals: boolean };

export type WorksheetField = {
  key: string;
  label: string;
  type: FieldType;
  hint?: string;
  options?: string[];
  /** Free text beside the options, where up offers "other". */
  other?: boolean;
  /** A choice's help per option, shown once that option is chosen (a barrier layer's next step). */
  option_hints?: Record<string, string>;
  /** up's anchors for 0, 1 and 2. */
  score_labels?: string[];
  /** A long field's own limit, above the usual 5,000 characters. */
  max_len?: number;
  // Tables.
  columns?: WorksheetField[];
  rows?: WorksheetRow[];
  row_header?: string;
  max_rows?: number;
  // Columns: a label column's text, and per-row options, by row key.
  text?: Record<string, string>;
  /** A label column whose text follows this column's answer in the same row (the error map's priority). */
  text_from?: string;
  row_options?: Record<string, string[]>;
  /** A column used only on these rows (a recording on the days whose evidence is one). */
  for_rows?: string[];
  show_when?: ShowWhen;
};

export type WorksheetSection = {
  key: string;
  title: string;
  hint?: string;
  added?: boolean;
  fields: WorksheetField[];
};

export type WorksheetReview = {
  key: string;
  label: string;
  days: number;
  from: { section?: string; field?: string; row?: string; column?: string };
};

export type WorksheetKind = {
  kind: string;
  name: string;
  group: WorksheetGroup;
  source: string;
  summary: string;
  private: boolean;
  attach: "none" | "state" | "document" | "state_or_document";
  document_kinds?: string[];
  /** A cycle close names the cycle it closes (up methods, phase 10). */
  closes_cycle?: boolean;
  reviews?: WorksheetReview[];
  row_reviews?: { section: string; field: string; row: string; review: string }[];
  version: number;
  sections: WorksheetSection[];
};

/** A table value: fixed rows carry their row key, free rows "". */
export type TableRow = { row: string; cells: Record<string, CellValue> };

export type CellValue = string | number | boolean | string[];
export type FieldValue = CellValue | TableRow[];

/** section → field → value. */
export type Answers = Record<string, Record<string, FieldValue>>;

export type ReviewDate = { due: string; earliest: string; done?: boolean };

/** One take on a worksheet (up-methods phase 7). An audio value is its id. */
export type Recording = {
  id: string;
  worksheet_id: string;
  mime: "audio/webm" | "audio/ogg" | "audio/mp4";
  bytes: number;
  duration_seconds: number;
  created_at: string;
};

export type Worksheet = {
  id: string;
  kind: string;
  kind_version: number;
  title: string;
  answers: Answers;
  state_id?: string;
  document_id?: string;
  /** The cycle a cycle close closes (up methods, phase 10). */
  cycle_id?: string;
  status: "open" | "done";
  private: boolean;
  reviews: Record<string, ReviewDate>;
  /** The worksheet's own recordings, oldest first. */
  recordings: Recording[];
  created_at: string;
  /** The revision a PATCH carries back. */
  updated_at: string;
};

export type WorksheetSummary = Omit<Worksheet, "answers" | "kind_version" | "created_at" | "recordings">;

export type WorksheetDetail = {
  worksheet: Worksheet;
  /** Absent when the kind is no longer served. */
  kind?: WorksheetKind;
  /** "section.field" paths the kind no longer has, shown read-only. */
  earlier: string[];
};

/** One diagnosed problem in a writing evidence card's draft (phase 4). */
export type DiagnosisIssue = {
  /** An exact span of the learner's draft. */
  quote: string;
  problem: string;
  basis: string;
  confidence: "low" | "medium" | "high";
  might_be_wrong: string;
};

/** One revision pass's diagnosis of one draft. It never holds a rewrite. */
export type WritingDiagnosis = {
  id: string;
  worksheet_id: string;
  /** 1–5, the row of the card's five-pass table. */
  pass: number;
  issues: DiagnosisIssue[];
  model: string;
  created_at: string;
};

export type DueReview = {
  id: string;
  kind: string;
  name: string;
  /** "Private note" for a private worksheet. */
  title: string;
  private: boolean;
  review: string;
  label: string;
  due: string;
};
