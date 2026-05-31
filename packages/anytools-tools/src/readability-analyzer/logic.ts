// Heuristic syllable counter for English. Good enough for readability metrics.
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  let count = 0;
  let prevVowel = false;
  for (const ch of w) {
    const isVowel = 'aeiouy'.includes(ch);
    if (isVowel && !prevVowel) count++;
    prevVowel = isVowel;
  }
  // Silent -e: only deduct when the pattern is vowel+consonant+e (e.g. "make", "hope")
  // Avoids false deductions on words like "simple", "purple" where -le is its own syllable
  const secondLast = w[w.length - 2];
  const thirdLast = w[w.length - 3];
  const isConsonantBefore = secondLast !== undefined && !'aeiouy'.includes(secondLast);
  const isVowelBefore = thirdLast !== undefined && 'aeiouy'.includes(thirdLast);
  if (w.endsWith('e') && count > 1 && isConsonantBefore && isVowelBefore) count--;
  return Math.max(1, count);
}

export function complexWords(words: string[]): number {
  return words.filter((w) => syllables(w) >= 3).length;
}

export type ReadabilityResult = {
  words: number;
  sentences: number;
  syllables: number;
  flesch: number;
  fkGrade: number;
  fog: number;
  level: string;
};

export function analyze(text: string): ReadabilityResult | null {
  const cleaned = text.trim();
  if (!cleaned) return null;
  const sentences = Math.max(1, (cleaned.match(/[.!?]+/g) ?? []).length);
  const words = cleaned.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  if (wordCount === 0) return null;
  const sylls = words.reduce((s, w) => s + syllables(w), 0);

  const wordsPerSentence = wordCount / sentences;
  const sylPerWord = sylls / wordCount;

  // Flesch Reading Ease (0-100, higher = easier)
  const flesch = 206.835 - 1.015 * wordsPerSentence - 84.6 * sylPerWord;
  // Flesch-Kincaid Grade Level
  const fkGrade = 0.39 * wordsPerSentence + 11.8 * sylPerWord - 15.59;
  // Gunning Fog Index
  const complexPct = (complexWords(words) / wordCount) * 100;
  const fog = 0.4 * (wordsPerSentence + complexPct);

  let level = 'Universal';
  if (flesch < 30) level = 'College graduate';
  else if (flesch < 50) level = 'College';
  else if (flesch < 60) level = '10th–12th grade';
  else if (flesch < 70) level = '8th–9th grade';
  else if (flesch < 80) level = '7th grade';
  else if (flesch < 90) level = '6th grade';

  return {
    words: wordCount,
    sentences,
    syllables: sylls,
    flesch,
    fkGrade: Math.max(0, fkGrade),
    fog: Math.max(0, fog),
    level,
  };
}
