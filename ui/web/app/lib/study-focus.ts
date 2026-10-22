/**
 * study-focus.ts
 * What the learner came to learn (the private design notes, phase 7),
 * asked on Home's first visit: Home lists the parts of AnyLearn that serve
 * it, and leaves out the parts made for another purpose until asked. Mirrors
 * store.StudyFocuses.
 */
export const STUDY_FOCUSES = ["languages", "documents", "exams", "research", "body"] as const;
export type StudyFocus = (typeof STUDY_FOCUSES)[number];

/** Pages that serve one purpose only, by the focus they serve. Everything else is for every learner. */
const ONLY_FOR: Record<Exclude<StudyFocus, "documents">, string[]> = {
  languages: ["/languages", "/mastery/vocabulary", "/mastery/decks"],
  exams: ["/quiz/exams"],
  research: ["/research"],
  body: ["/body"],
};

/** Whether a page belongs on Home for this focus; no focus (not asked, or skipped) shows everything. */
export function servesFocus(to: string, focus: readonly string[] | null | undefined): boolean {
  if (!focus || focus.length === 0) return true;
  for (const [key, prefixes] of Object.entries(ONLY_FOR)) {
    if (prefixes.some((p) => to === p || to.startsWith(`${p}/`))) return focus.includes(key);
  }
  return true;
}

export function isStudyFocus(v: string): v is StudyFocus {
  return (STUDY_FOCUSES as readonly string[]).includes(v);
}
