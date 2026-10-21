/**
 * library/word-lists.server.ts
 * Adds one level of a Library word list to the learner's words in its
 * language (the private design notes, phase 4): the
 * vocabulary import, 200 a batch, paced 20 new a day as an Anki deck is,
 * and the language put on the learner's list if it has room.
 */
import { importWords, setStudiedLanguages, studiedLanguages } from "~/lib/vocab.server";
import { MAX_STUDIED } from "~/lib/languages";
import { WORD_LISTS, wordListOrigin } from "~/lib/library/word-lists";

/** vocab.MaxImportBatch. */
const BATCH = 200;

type ListFile = { default: { levels: { id: string; notes: { t: string; m: string }[] }[] } };

const FILES: Record<string, () => Promise<ListFile>> = {
  ngsl: () => import("~/data/library/words/ngsl.json"),
  nawl: () => import("~/data/library/words/nawl.json"),
  hsk3: () => import("~/data/library/words/hsk3.json"),
  hsk2: () => import("~/data/library/words/hsk2.json"),
  jlpt: () => import("~/data/library/words/jlpt.json"),
};

export type WordsAdded = { created: number; duplicates: number; invalid: number; firstDay?: string; lastDay?: string; language: string };

export async function addWordListLevel(userId: string, listId: string, levelId: string): Promise<WordsAdded | null> {
  const list = WORD_LISTS.find((l) => l.list === listId);
  const load = FILES[listId];
  if (!list || !load || !list.levels.some((l) => l.id === levelId)) return null;
  const level = (await load()).default.levels.find((l) => l.id === levelId);
  if (!level) return null;
  const out: WordsAdded = { created: 0, duplicates: 0, invalid: 0, language: list.language };
  for (let i = 0; i < level.notes.length; i += BATCH) {
    const notes = level.notes.slice(i, i + BATCH).map((n) => ({ term: n.t, meaning: n.m, sentence: "" }));
    const r = await importWords(userId, list.language, notes, wordListOrigin(levelId));
    out.created += r.created;
    out.duplicates += r.duplicates;
    out.invalid += r.invalid;
    out.firstDay ??= r.first_day;
    out.lastDay = r.last_day ?? out.lastDay;
  }
  // The language's tab, so the words are where the learner looks.
  const { studied } = await studiedLanguages(userId);
  if (!studied.includes(list.language) && studied.length < MAX_STUDIED) {
    await setStudiedLanguages(userId, [...studied, list.language], list.language);
  }
  return out;
}
