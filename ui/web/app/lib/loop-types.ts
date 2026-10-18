/**
 * loop-types.ts
 * Wire shapes for the learning loop (internal/api/loopapi).
 *
 * Client-safe on purpose, like study-types.ts: components render these.
 */

export const PHASES = ["calibrate", "stack", "deliver"] as const;
export type Phase = (typeof PHASES)[number];

export const TIMEPOINTS = ["baseline", "immediate", "delayed", "transfer"] as const;
export type Timepoint = (typeof TIMEPOINTS)[number];

export type EvidenceKind =
  | "question_attempt"
  | "kp_state"
  | "note"
  | "research_report"
  | "chat_message"
  | "explain_back"
  | "card_entry"
  | "worksheet";
export type EvidenceStatus = "suggested" | "accepted" | "dismissed";

export type Hypothesis = {
  claim: string;
  evidence?: string;
  next_test?: string;
  stop_condition?: string;
  confidence?: string;
  week?: number;
  source: string;
};

export type LearningState = {
  id: string;
  goal: string;
  real_scenario: string;
  outcome_12w: string;
  ai_boundaries: { ai_may: string[]; human_must_confirm: string[] };
  baselines: { what: string; measure: string; at: string }[];
  validated_methods: { method: string; evidence: string }[];
  hypotheses: Hypothesis[];
  handover_md: string;
  next_task: string;
  next_task_minimum: string;
  /** Phase 13: the bad-day contract. ask_for_help_when never reaches a model. */
  minimum_contract: MinimumContract;
  created_at: string;
  updated_at: string;
};

/** up, rhythm-and-compounding.md §6: three answers written before a bad day. */
export type MinimumContract = {
  downshift_when?: string;
  still_worth_keeping?: string;
  ask_for_help_when?: string;
};

/** up, 90-day-cycle.md §6 "Interruption and recovery", in up's order. */
export const RESISTANCES = ["time", "difficulty", "energy", "environment", "responsibility"] as const;
export type Resistance = (typeof RESISTANCES)[number];

/**
 * One logged interruption. Entries from before phase 13 carry only `note`
 * (shown as the fact) and `prior_task`; every newer line is optional on read.
 */
export type Interruption = {
  at: string;
  fact?: string;
  note?: string;
  resistance?: Resistance;
  reduced_to?: string;
  within_24h?: string;
  not_repaying?: string;
  review_on?: string;
  prior_task: string;
};

export type InterruptBody = {
  fact: string;
  resistance: Resistance | "";
  minimum: string;
  within_24h: string;
  not_repaying: string;
  review_on: string;
};

export type StateSummary = LearningState & {
  cycle_id: string | null;
  phase: Phase | "";
  cycle_started_at: string | null;
};

export type GateResult = {
  from: string;
  to: string;
  open: boolean;
  final: boolean;
  missing: string[];
  cannot_prove: string[];
  counted: string[];
  progress: { requirement: string; have: number; need: number }[] | null;
};

export type WeeklyQuestion = { question: string; capacity: "full" | "reduced" | "minimum" };

export type Cycle = {
  id: string;
  state_id: string;
  started_at: string;
  phase: Phase;
  gate_evidence: { from: string; to: string; at: string; ref_ids: string[]; reviews: number }[];
  weekly_questions: WeeklyQuestion[];
  interruptions: Interruption[];
  day90_review_md: string;
};

export type ReviewError = {
  evidence: string;
  cause: string;
  confidence: "" | "low" | "medium" | "high";
  next_test: string;
  stop_condition: string;
};

export type WeeklyReview = {
  id: string;
  cycle_id: string;
  week_no: number;
  completion: number | null;
  quality: number | null;
  retention: number | null;
  transfer: number | null;
  errors: ReviewError[];
  energy: string;
  one_variable_change: string;
  writeback_done: boolean;
};

export type CycleDetail = Cycle & {
  goal: string;
  current_week: number;
  /** The cycle's day on the learner's calendar, 1 on its start day. */
  day: number;
  /** From this day the page offers "Close this cycle" (up methods, phase 10). */
  close_from_day: number;
  gate: GateResult;
  reviews: WeeklyReview[];
};

export type Target = { label: string; detail: string; occurred_at: string; link?: string };

export type EvidenceRef = {
  id: string;
  review_id?: string;
  chain_id?: string;
  timepoint?: Timepoint;
  kind: EvidenceKind;
  ref_id: string;
  note: string;
  status: EvidenceStatus;
  suggested_by: "user" | "job";
  target: Target | null;
};

export type Candidate = Target & {
  kind: EvidenceKind;
  ref_id: string;
  timepoint?: Timepoint | "";
  status?: EvidenceStatus | "";
};

export type ReviewDetail = {
  review: WeeklyReview;
  evidence: EvidenceRef[];
  problems: string[];
  cannot_prove: string;
  cycle: { id: string; state_id: string; phase: Phase; started_at: string; goal: string };
};

export type Chain = {
  id: string;
  state_id: string;
  question: string;
  split: { fact: string; interpretation: string; hypothesis: string };
};

export type ChainDetail = Chain & {
  columns: { timepoint: Timepoint; refs: EvidenceRef[] }[];
  complete: boolean;
  cannot_prove: string;
};

export type Brief = {
  id: string;
  state_id: string;
  task: string;
  data_boundary_note: string;
  output_eval: string;
  ai_scope: string;
  human_gates: string;
  cost_reversibility: string;
  failure_rollback: string;
  handover: string;
  pre_start_check: Record<string, boolean>;
};

export const PRE_START_CHECKS = [
  "output_eval_written",
  "human_gates_named",
  "rollback_known",
  "baseline_recorded",
] as const;

export const LOG_METRICS = ["completion", "quality", "independent_perf", "rework", "cost", "transfer"] as const;
export type LogMetric = (typeof LOG_METRICS)[number];

export type Cell = { value: number | null; note: string };

export type ThreeWayRow = {
  metric: LogMetric;
  measure: string;
  baseline_noai: Cell;
  assisted: Cell;
  delayed_independent: Cell;
  reading: "incomplete" | "retained" | "only_with_ai" | "no_gain";
  cannot_prove: string;
};

export type LearningLog = {
  id: string;
  brief_id: string;
  baseline_noai: Record<string, Cell>;
  assisted: Record<string, Cell>;
  delayed_independent: Record<string, Cell>;
  metrics: Record<string, string>;
  next_cycle_decision: string;
};

export type LogDetail = { log: LearningLog; rows: ThreeWayRow[] };

export type BriefDetail = { brief: Brief; unchecked: string[]; logs: LogDetail[] };

export type StateDetail = {
  state: LearningState;
  revision: string;
  cycle: Cycle | null;
  gate: GateResult | null;
  chains: Chain[];
  briefs: Brief[];
  cards: SkillCard[];
  /** Set when the last three interruptions all named this resistance. */
  repeated_resistance: Resistance | "";
};

export type HandoverResult = {
  valid: boolean;
  problems: string[];
  accepted: boolean;
  paste_back?: { restated: string[]; next_task: string; handover_md: string };
};

// ── skill evidence cards (phase 8) ─────────────────────────────────────────
// The kinds, their setup fields and their prompts are NOT defined here: the
// API serves them (GET /v1/learning/card-kinds) from the one Go table, and the
// pages render what it serves. `kind` is therefore a plain string.

export type CardStatus = "open" | "retest_due" | "closed";

export const PROMPT_LEVELS = ["unaided", "light_cue", "heavy_cue"] as const;
export type PromptLevel = (typeof PROMPT_LEVELS)[number];

export type SetupField = { key: string; label: string; hint: string; required: boolean };

export type CardKind = {
  kind: string;
  name: string;
  summary: string;
  retest_delay_days: number;
  setup: SetupField[];
  prompts: Partial<Record<Timepoint, string[]>>;
};

export type CardLinkKind = "note" | "document" | "quiz_attempt";

export type CardLink = {
  kind: CardLinkKind;
  id: string;
  page?: number;
  label?: string;
  path?: string;
  missing?: boolean;
};

export type SkillCard = {
  id: string;
  state_id: string;
  chain_id: string;
  kind: string;
  title: string;
  setup: Record<string, string>;
  status: CardStatus;
  baseline_at: string | null;
  retest_due_on: string;
  closed_at: string | null;
  reflection: { held?: string; missed?: string; next?: string };
  created_at: string;
};

export type CardEntry = {
  id: string;
  card_id: string;
  timepoint: Timepoint;
  body: string;
  prompt_level: PromptLevel;
  links: CardLink[];
  /** A baseline whose retest is pending: body and links are empty. */
  withheld: boolean;
  created_at: string;
};

export type CardDetail = {
  card: SkillCard;
  kind: CardKind;
  entries: CardEntry[];
  today: string;
  retest_open: boolean;
  baseline_hidden: boolean;
  allowed: Timepoint[];
};

export type RetestDue = { card_id: string; state_id: string; kind: string; title: string; retest_due_on: string };

/** A score 0–2, or a dash while the check is unscored. */
export function scoreText(n: number | null): string {
  return n === null ? "–" : `${n}/2`;
}
