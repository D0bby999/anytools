/**
 * book-types.ts
 * Wire shapes for living books (internal/api/bookapi, learning depth phase
 * 11), and the small client-safe helpers the editor and the reader share.
 * Client-safe: components import it, so it must not import a `.server.ts`
 * module.
 */
import type { Source } from "~/hooks/use-turn-stream";
import type { QuestionView } from "~/lib/study-types";

export type OutlineItem = {
  chunk_id: string;
  document_id: string;
  title: string;
  page?: number;
  heading?: string;
  snippet: string;
};

export type ProposedChapter = {
  title: string;
  objectives: string[];
  /** 1-based numbers of EARLIER chapters. */
  prereqs: number[];
  /** Chunk ids from the outline. */
  anchors: string[];
};

export type Proposal = {
  title: string;
  audience: string;
  chapters: ProposedChapter[];
  outline?: OutlineItem[];
};

export type ChapterStatus = "pending" | "compiling" | "ready" | "error" | "paused";

export type Chapter = {
  id: string;
  book_id: string;
  ord: number;
  title: string;
  objectives: string[];
  prereqs: number[];
  anchors: string[];
  status: ChapterStatus;
  error?: string;
  compiled_at?: string;
  blocks: number;
  ready: number;
  stale: boolean;
  estimated_calls: number;
};

export type Book = {
  id: string;
  kb_id: string;
  title: string;
  goal: string;
  length: number;
  status: "proposed" | "confirmed" | "archived";
  proposal: Proposal;
  paused_reason?: string;
  chapters: Chapter[];
  created_at: string;
  updated_at: string;
  compiling: boolean;
  progress?: { done: number; total: number; billed: number };
  estimated_calls: number;
};

export type BlockType =
  | "text"
  | "callout"
  | "worked_example"
  | "diagram"
  | "quiz"
  | "flash_cards"
  | "summary"
  | "note";

export type FlashCard = { front: string; back: string };

export type Block = {
  id: string;
  chapter_id: string;
  ord: number;
  type: BlockType;
  status: "pending" | "ready" | "error";
  title: string;
  brief?: string;
  payload: Record<string, unknown>;
  sources: Source[];
  error?: string;
  version: number;
  created_at: string;
  questions?: QuestionView[];
  cards?: FlashCard[];
  in_review?: boolean;
};

export type ChapterView = { chapter: Chapter; blocks: Block[] };

export type MarkdownPayload = { markdown: string };
export type CalloutPayload = { variant: "definition" | "warning" | "tip"; title: string; markdown: string };
export type ExamplePayload = { problem: string; steps: string[]; answer: string };
export type DiagramPayload = { kind: "mermaid" | "chart"; source: string; caption: string };

/** The fenced block RichText draws for a diagram, then its caption. */
export function diagramMarkdown(p: DiagramPayload): string {
  const fence = `\`\`\`${p.kind}\n${p.source}\n\`\`\``;
  return p.caption ? `${fence}\n\n${p.caption}` : fence;
}

/** Book limits the editor holds to, as the server does. */
export const MIN_CHAPTERS = 4;
export const MAX_CHAPTERS = 12;

/**
 * An outline chapter with a stable key, so reordering carries its
 * prerequisites with it: the editor keeps prerequisites as keys and only
 * turns them into chapter numbers when it saves.
 */
export type DraftChapter = {
  key: string;
  title: string;
  objectives: string;
  prereqs: string[];
  anchors: string[];
};

export function toDraft(chapters: ProposedChapter[]): DraftChapter[] {
  const keys = chapters.map((_, i) => `c${i + 1}`);
  return chapters.map((c, i) => ({
    key: keys[i] ?? `c${i + 1}`,
    title: c.title,
    objectives: c.objectives.join("\n"),
    prereqs: c.prereqs.map((n) => keys[n - 1] ?? "").filter(Boolean),
    anchors: [...c.anchors],
  }));
}

/**
 * The outline to save: objectives one per line, and each prerequisite as the
 * number of a chapter that is still EARLIER after the edit — one that moved
 * after this chapter, or was cut, is dropped rather than sent forward.
 */
export function fromDraft(draft: DraftChapter[]): ProposedChapter[] {
  const position = new Map(draft.map((c, i) => [c.key, i + 1]));
  return draft.map((c, i) => ({
    title: c.title.trim(),
    objectives: c.objectives
      .split("\n")
      .map((o) => o.trim())
      .filter(Boolean),
    prereqs: c.prereqs
      .map((k) => position.get(k) ?? 0)
      .filter((n) => n >= 1 && n <= i)
      .sort((a, b) => a - b),
    anchors: c.anchors,
  }));
}
