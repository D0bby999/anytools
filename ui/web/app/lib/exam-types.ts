/**
 * exam-types.ts
 * Wire shapes for past papers and mock exams (internal/api/examapi, learning
 * depth phase 3). Client-safe: components render these.
 */
import type { Source } from "~/hooks/use-turn-stream";
import type { Judgement, QuestionType, QuestionView } from "~/lib/study-types";

export type TemplateStatus = "queued" | "parsing" | "extracting" | "review" | "ready" | "failed";
export type ExamStatus = "generating" | "ready" | "in_progress" | "submitted" | "failed";
/** A pdf or image paper renders its pages with pdf.js; docx and text do not. */
export type PaperKind = "pdf" | "image" | "docx" | "text";
export type Difficulty = "easy" | "medium" | "hard";

/** A multi-call job's checkpoint: units done, of how many, and calls billed. */
export type JobProgress = { done: number; total: number; billed: number };

export type TemplateOption = { label: string; text_md: string };
export type SubQuestion = { label: string; stem_md: string; points?: number };

/** One question of a template, as extracted and reviewed. */
export type TemplateItem = {
  number: string;
  type: QuestionType;
  topic?: string;
  stem_md: string;
  options: TemplateOption[] | null;
  answer_key?: string;
  points: number;
  difficulty: Difficulty;
  source_page: number;
  figure_page?: number;
  sub_questions?: SubQuestion[];
  /** What is wrong with it; the template cannot be marked ready until fixed. */
  issues?: string[];
};

export type ExamTemplate = {
  id: string;
  title: string;
  filename: string;
  kind: PaperKind;
  bytes: number;
  page_count: number;
  status: TemplateStatus;
  error?: string;
  parsed_by?: string;
  items: TemplateItem[];
  warnings: string[];
  total_points: number;
  time_limit_minutes?: number;
  job_id?: string;
  created_at: string;
  updated_at: string;
  progress?: JobProgress;
};

export type Dropped = { ord: number; number: string; reason: string };

export type Exam = {
  id: string;
  template_id?: string;
  kb_id: string;
  title: string;
  status: ExamStatus;
  error?: string;
  requested: number;
  generated: number;
  dropped: Dropped[];
  time_limit_minutes?: number;
  started_at?: string;
  submitted_at?: string;
  score?: number;
  max_score?: number;
  job_id?: string;
  created_at: string;
};

export type ExamItemView = {
  id: string;
  ord: number;
  number: string;
  points: number;
  question: QuestionView;
  answer: string;
  score?: number;
  awarded?: number;
  correct?: boolean;
  judge?: Judgement;
};

export type ExamView = Exam & {
  items: ExamItemView[];
  item_count: number;
  deadline_at?: string;
  late: boolean;
  taken_seconds?: number;
  marked: number;
  progress?: JobProgress;
  sources: Source[];
  server_now: string;
};

/** A template is being read and listed while its job runs. */
export function templateWorking(status: TemplateStatus): boolean {
  return status === "queued" || status === "parsing" || status === "extracting";
}

/** "m:ss", or "h:mm:ss" past an hour. */
export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
