/** Pure word/character counting logic. */

export type WordCountResult = {
  chars: number;
  charsNoSpaces: number;
  words: number;
  sentences: number;
  paragraphs: number;
  lines: number;
  avgWordLength: number;
};

/** Compute word, character, sentence, paragraph, and line counts for a text string. */
export function countText(text: string): WordCountResult {
  const chars = text.length;
  const charsNoSpaces = text.replace(/\s/g, '').length;
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
  const sentences = text.trim() === '' ? 0 : (text.match(/[.!?]+(?:\s|$)/g) ?? []).length;
  const paragraphs =
    text.trim() === '' ? 0 : text.split(/\n\s*\n/).filter((p) => p.trim()).length;
  const lines = text === '' ? 0 : text.split('\n').length;

  // Average word length in characters (no spaces), 0 when no words
  const wordList = text.trim() === '' ? [] : text.trim().split(/\s+/);
  const avgWordLength =
    wordList.length === 0
      ? 0
      : wordList.reduce((s, w) => s + w.length, 0) / wordList.length;

  return { chars, charsNoSpaces, words, sentences, paragraphs, lines, avgWordLength };
}
