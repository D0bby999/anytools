/**
 * profile-types.ts
 * The learner profile's shapes, as internal/learning/profile serialises them,
 * and where each kind of evidence links to.
 */

/** Sections in display order, exactly as the server lists them. */
export const SECTIONS = ["studying", "strengths", "struggles", "preferences", "constraints"] as const;
export type Section = (typeof SECTIONS)[number];

export function isSection(value: string): value is Section {
  return (SECTIONS as readonly string[]).includes(value);
}

/** A ref resolved for the owner on read; `exists` is false when it is gone. */
export type RefView = {
  kind: "mistake" | "knowledge_point" | "knowledge_base" | "vocab_card" | "skill_card";
  id: string;
  exists: boolean;
  label?: string;
  parent_id?: string;
};

export type ProfileEntry = {
  id: string;
  section: Section;
  text: string;
  refs: RefView[];
  origin: "learner" | "consolidated";
  status: "proposed" | "accepted" | "rejected";
  op: "add" | "update" | "remove";
  replaces_id?: string;
  replaces_text?: string;
  kb_id?: string;
  kb_name?: string;
  run_id?: string;
  decided_at?: string;
  created_at: string;
  updated_at: string;
};

export type RunOp = {
  op: string;
  section?: string;
  text?: string;
  status: "proposed" | "dropped";
  reason?: string;
};

export type ProfileRun = {
  id: string;
  started_at: string;
  finished_at?: string;
  status: "running" | "succeeded" | "skipped" | "failed";
  ops: RunOp[];
  error?: string;
  model?: string;
};

export type Profile = {
  entries: ProfileEntry[];
  consolidation: boolean;
  last_run: ProfileRun | null;
  max_per_section: number;
  max_text_runes: number;
};

/**
 * Where a ref opens: the mistake in practice, the point's path, the
 * knowledge base, the word list, the skill card. A ref that no longer
 * resolves opens nothing.
 */
export function refHref(ref: RefView): string | null {
  if (!ref.exists) return null;
  const id = encodeURIComponent(ref.id);
  switch (ref.kind) {
    case "mistake":
      return ref.parent_id ? `/quiz/practice?kb_id=${encodeURIComponent(ref.parent_id)}` : "/quiz/practice";
    case "knowledge_point":
      return ref.parent_id ? `/mastery/${encodeURIComponent(ref.parent_id)}` : "/mastery";
    case "knowledge_base":
      return `/knowledge/${id}`;
    case "vocab_card":
      return "/mastery/vocabulary";
    case "skill_card":
      return `/loop/cards/${id}`;
  }
  return null;
}
