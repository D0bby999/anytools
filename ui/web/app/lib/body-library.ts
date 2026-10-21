/**
 * body-library.ts
 * What the exercise library shows beside an exercise's text (plans/
 * a private plan, phase 3): wger's name in the learner's
 * language, and its page, which has a video for some.
 */
import type { Exercise } from "~/lib/body-types";

/** wger's name in the language, when it has one; the library's English otherwise. */
export function exerciseName(e: Pick<Exercise, "name" | "wger">, language: string): string {
  return e.wger?.names[language.split("-")[0]!] ?? e.name;
}

/** The exercise's page on wger, which has its video when there is one. */
export const wgerPage = (id: number) => `https://wger.de/en/exercise/${id}/view/`;
