/**
 * library/word-lists.ts
 * The Library's exam word lists (the private design notes,
 * phase 4), without their words: names, levels and credits, for the
 * catalogue and for a word's "from" line. The words are in
 * app/data/library/words/<list>.json, loaded on the server when added.
 */
import index from "~/data/library/words/index.json";
import type { Licence } from "~/lib/library/types";

export type WordList = {
  list: string;
  name: string;
  language: string;
  licence: Licence;
  source: string;
  credit: string;
  levels: { id: string; name: string; count: number }[];
};

export const WORD_LISTS = index as WordList[];

/** The origin a word from this level is recorded with (vocab.OriginLibrary). */
export const wordListOrigin = (levelId: string) => `library:${levelId}`;

/** The list and level a word's origin names, if it came from one. */
export function wordListOf(origin: string | undefined) {
  if (!origin?.startsWith("library:")) return null;
  const id = origin.slice("library:".length);
  for (const list of WORD_LISTS) {
    const level = list.levels.find((l) => l.id === id);
    if (level) return { list, level };
  }
  return null;
}
