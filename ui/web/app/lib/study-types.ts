/**
 * study-types.ts
 * Wire shapes for quiz and mastery (internal/api/{quizapi,masteryapi}).
 *
 * Client-safe on purpose: components render these, and a component importing a
 * `.server.ts` module pulls the gateway token into the browser bundle.
 */
import type { Source } from "~/hooks/use-turn-stream";

export type QuestionType = "mcq" | "short" | "tf" | "cloze" | "written" | "code";

export const QUESTION_TYPES: readonly QuestionType[] = ["mcq", "tf", "short", "cloze", "written", "code"];

/** The types an exam item can be: a code exercise is practised, not sat (exam/items.go). */
export const EXAM_TYPES: readonly QuestionType[] = QUESTION_TYPES.filter((t) => t !== "code");

/**
 * The types a plain quiz can ask for. `written` is not one: its rubric is
 * written and checked by a mock exam (internal/capabilities/exam), and a
 * written question without one could not be marked.
 */
export const GENERATABLE_TYPES: readonly QuestionType[] = ["mcq", "tf", "short", "cloze", "code"];

/** Ticked by default: a code exercise is asked for, for material that teaches Python. */
export const DEFAULT_TYPES: readonly QuestionType[] = ["mcq", "tf", "short", "cloze"];

/** One line of a written question's rubric. */
export type Criterion = { criterion: string; points: number };

/** What the marking awarded for one criterion. */
export type CriterionResult = Criterion & { awarded: number; comment?: string };

/** The learner's own account of an attempt, as internal/learning names it. */
export const ATTRIBUTIONS = ["", "confident", "guessed", "careless", "misread", "knowledge_gap"] as const;
export type Attribution = (typeof ATTRIBUTIONS)[number];

/**
 * A question as the API returns it. `answer` and `explanation` are ABSENT until
 * the learner has attempted it — the API redacts them, not this type.
 */
export type QuestionView = {
  id: string;
  kb_id: string;
  prompt: string;
  type: QuestionType;
  options: { label: string; body: string }[];
  difficulty: "easy" | "medium" | "hard";
  source_chunk_ids: string[];
  created_at: string;
  revealed: boolean;
  answer?: string;
  explanation?: string;
  /** A written question's rubric; revealed with the answer. */
  rubric?: Criterion[];
  knowledge_point_id?: string;
  module_id?: string;
  /** The answer is maths, marked by value: the card offers a math field. */
  math?: boolean;
  /** A code exercise's starting code and tests, run in the browser; its solution is `answer`. */
  code?: { module: string; starter: string; tests: string; credit?: string };
};

/** One open mistake in the practice queue (GET /v1/quiz/practice). */
export type PracticeItem = {
  question: QuestionView;
  status: "active" | "retrying" | "review";
  opened_at: string;
  misses: number;
  kb_name: string;
};

export type PracticeQueue = { items: PracticeItem[]; remaining: number };

export type Judgement = {
  correct: boolean;
  mode: "exact" | "llm" | "rubric" | "user" | "math" | "tests";
  reason?: string;
  missing?: string[];
  error_type?: string;
  /** A rubric's marking: the share of the points, and each criterion's. */
  score?: number;
  criteria?: CriterionResult[];
  /** A maths answer equal to the recorded one but not in the form asked: right, scheduled as Hard. */
  almost?: boolean;
  /** A code attempt's tests, as the browser ran them. */
  tests?: { name: string; passed: boolean; message?: string }[];
};

export type Attempt = {
  id: string;
  question_id: string;
  user_answer: string;
  is_correct: boolean;
  /** Partial credit, 0–1, for a written answer; correct is score ≥ 0.7. */
  score?: number;
  judge: Judgement;
  error_type: string;
  self_attribution: string;
  rating: "again" | "hard" | "good" | "easy";
  overridden_at?: string;
  created_at: string;
};

export type Scheduled = {
  knowledge_point_id: string;
  due_at: string;
  mastery_estimate: number;
  rating: string;
  lapses: number;
};

export type AttemptResult = {
  attempt: Attempt;
  answer: string;
  explanation: string;
  scheduled?: Scheduled;
  sources: Source[];
};

export type GenerateResult = {
  questions: QuestionView[];
  requested: number;
  dropped_citations: number;
  provider: string;
  model: string;
  note?: string;
};

export type BankEntry = {
  question: QuestionView;
  attempts: number;
  last_correct?: boolean | null;
  last_attempt?: string | null;
  last_attempt_id?: string | null;
  kb_name: string;
  module_name: string;
  knowledge_point_name: string;
};

// ── mastery ──────────────────────────────────────────────────────────────────

export type Path = {
  id: string;
  kb_id: string;
  goal: string;
  status: "active" | "archived";
  created_at: string;
};

export type PathSummary = {
  path: Path;
  kb_name: string;
  modules: number;
  knowledge_points: number;
  due_count: number;
  mastery: number;
  graduated_modules: number;
};

export type KnowledgePoint = { id: string; module_id: string; name: string; type: string };

export type KPView = {
  knowledge_point: KnowledgePoint;
  state: {
    due_at: string;
    mastery_estimate: number;
    status: string;
    reviews: number;
    lapses: number;
    /** When the point's explain-back was passed; absent until then. */
    explain_passed_at?: string;
  };
  due: boolean;
};

export type ModuleView = {
  module: { id: string; ord: number; name: string; objective: string; pass_threshold: number };
  knowledge_points: KPView[];
  mastery: number;
  due_count: number;
  graduated: boolean;
};

export type PathDetail = {
  path: Path;
  kb_name: string;
  modules: ModuleView[];
  due_count: number;
  mastery: number;
  /** Concept and design points need a passed explain-back to graduate. */
  explain_gate: boolean;
};

export type ProposedModule = {
  name: string;
  objective: string;
  pass_threshold: number;
  knowledge_points: { name: string; type: string }[];
};

export type Proposal = { modules: ProposedModule[]; note?: string; model?: string };

export type DueItem = {
  knowledge_point_id: string;
  knowledge_point_name: string;
  module_name: string;
  path_id: string;
  path_goal: string;
  due_at: string;
};

/** A cached teaching text for one knowledge point (mastery/learn.go). */
export type Explanation = {
  id: string;
  knowledge_point_id: string;
  model: string;
  variant: number;
  body_md: string;
  sources: Source[];
  /** A cited document changed since this was written. */
  stale: boolean;
  cached: boolean;
  created_at: string;
};

/** How many "explain it differently" angles a point has (MaxVariants). */
export const EXPLANATION_VARIANTS = 5;

export type ExplainVerdict = "pending" | "passed" | "failed" | "unjudged";

export type ExplainBackAttempt = {
  id: string;
  knowledge_point_id: string;
  path_id: string;
  request_id: string;
  explanation: string;
  verdict: ExplainVerdict;
  passed: boolean;
  gaps: string[];
  misconceptions: string[];
  feedback: string;
  sources: Source[];
  /** The learner's own verdict, when they disputed the judge's. */
  override_passed?: boolean;
  overridden_at?: string;
  created_at: string;
};

export type ExplainBackResult = {
  attempt: ExplainBackAttempt;
  scheduled?: Scheduled;
  graduated: { module_id: string; name: string; mastery: number }[];
  replayed: boolean;
};

/**
 * What the session serves next. `kind` says which card: the question shape is
 * unchanged, `learn` carries an explanation and `explain_back` a prompt.
 */
export type NextQuestion = {
  kind: "question" | "learn" | "explain_back";
  question?: QuestionView;
  explanation?: Explanation;
  prompt?: string;
  last_explain_back?: ExplainBackAttempt;
  knowledge_point: KnowledgePoint;
  module_name: string;
  /** The point's path; the cross-path review shows it beside the module. */
  path_id: string;
  path_goal: string;
  /** Cross-path review only: this path has an explain-back waiting. */
  explain_back_waiting?: boolean;
  due: boolean;
  generated: boolean;
  remaining_due: number;
};

export type ErrorRecord = {
  id: string;
  question_id: string;
  prompt: string;
  knowledge_point_name: string;
  error_type: string;
  self_attribution: string;
  ai_confirmation: string;
  retries: number;
  status: string;
  updated_at: string;
};

/** Rounds a 0–1 estimate to a whole percentage for display. */
export function percent(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

/**
 * The line a question is listed by. A code exercise's prompt is Markdown
 * whose first line is its heading ("## Leap"): its title, not the whole text.
 */
export function promptLine(q: { prompt: string; type: QuestionType }): string {
  if (q.type !== "code") return q.prompt;
  const first = q.prompt.trimStart().split("\n")[0] ?? "";
  return first.replace(/^#{1,6}\s+/, "").trim() || q.prompt;
}
