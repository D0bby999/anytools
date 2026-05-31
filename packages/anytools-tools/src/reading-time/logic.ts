export const SPEAK_WPM = 150;
export const SKIM_WPM = 450;

export type ReadingTimeResult = {
  words: number;
  readSeconds: number;
  speakSeconds: number;
  skimSeconds: number;
};

/**
 * Counts words in a string. Returns 0 for blank input.
 * Split on any whitespace sequence.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Converts a word count + WPM to seconds of reading time.
 * Returns 0 when words is 0.
 */
export function wordsToSeconds(words: number, wpm: number): number {
  if (words <= 0 || wpm <= 0) return 0;
  return (words / wpm) * 60;
}

/**
 * Formats seconds into a human-readable string: "45s", "3 min", "3m 45s".
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s === 0 ? `${m} min` : `${m}m ${s}s`;
}

/**
 * Estimates reading, speaking, and skimming times for a given text and reading WPM.
 */
export function estimateReadingTime(text: string, readWpm: number): ReadingTimeResult {
  const words = countWords(text);
  return {
    words,
    readSeconds: wordsToSeconds(words, readWpm),
    speakSeconds: wordsToSeconds(words, SPEAK_WPM),
    skimSeconds: wordsToSeconds(words, SKIM_WPM),
  };
}
