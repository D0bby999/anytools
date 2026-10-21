/**
 * body-library.ts
 * What the exercise library shows beside an exercise's text (plans/
 * a private plan, phase 3): free-exercise-db's start and
 * end photos, staged under /tool-runtime/, and wger's name in the learner's
 * language.
 */
import type { Exercise } from "~/lib/body-types";

/** scripts/tool-runtime.json: free-exercise-db@0.0.0-f00c92c. */
export const FEDB_MEDIA = "/tool-runtime/free-exercise-db@0.0.0-f00c92c";

/** The start and end photos, or none. */
export function exercisePhotos(e: Pick<Exercise, "photo">): [string, string] | null {
  return e.photo ? [`${FEDB_MEDIA}/${e.photo}-0.jpg`, `${FEDB_MEDIA}/${e.photo}-1.jpg`] : null;
}

/** wger's name in the language, when it has one; the library's English otherwise. */
export function exerciseName(e: Pick<Exercise, "name" | "wger">, language: string): string {
  return e.wger?.names[language.split("-")[0]!] ?? e.name;
}

/** The exercise's page on wger, which has its video when there is one. */
export const wgerPage = (id: number) => `https://wger.de/en/exercise/${id}/view/`;
