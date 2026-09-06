/**
 * Counts tokens the way OpenAI's models do, plus plain characters and words for comparison.
 *
 * `js-tiktoken` ships six BPE rank tables bundled into its default entry (~5.6 MB uncompressed —
 * every encoding, whether used or not). This tool needs exactly two of them, so it imports
 * `js-tiktoken/lite` (the ~9 KB `Tiktoken` class, no ranks attached) and loads only the one rank
 * table the selected encoding needs (~1 MB for cl100k_base, ~2.3 MB for o200k_base) — both as
 * dynamic imports, never at module load, so the widget can show a loading state first and the
 * page that merely displays the tool pays nothing until the user actually runs it.
 */

export type EncodingId = 'cl100k_base' | 'o200k_base';

/** Not every model that uses an encoding — just enough to explain the choice to a user
 * comparing this count against a specific model's real usage. */
export function modelsForEncoding(encoding: EncodingId): string[] {
  return encoding === 'cl100k_base'
    ? ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo', 'text-embedding-ada-002']
    : ['gpt-4o', 'gpt-4.1', 'gpt-5', 'o1', 'o3'];
}

/** The subset of `Tiktoken` this tool calls — matches the real class's shape so a mock in tests
 * and the real `js-tiktoken/lite` export are interchangeable. */
export type Encoder = { encode(text: string): number[] };

const encoderCache = new Map<EncodingId, Promise<Encoder>>();

/** Loads (and caches) the encoder for one encoding. Safe to call repeatedly — switching back and
 * forth between the two encodings never re-fetches a rank table already in memory. */
export async function loadEncoder(encoding: EncodingId): Promise<Encoder> {
  const cached = encoderCache.get(encoding);
  if (cached) return cached;
  const promise = (async () => {
    const [{ Tiktoken }, ranksModule] = await Promise.all([
      import('js-tiktoken/lite'),
      encoding === 'cl100k_base'
        ? import('js-tiktoken/ranks/cl100k_base')
        : import('js-tiktoken/ranks/o200k_base'),
    ]);
    return new Tiktoken(ranksModule.default);
  })();
  encoderCache.set(encoding, promise);
  return promise;
}

export type TokenCounts = {
  tokens: number;
  characters: number;
  words: number;
};

/** Word count uses the same definition as the rest of this repo's text tools: runs of
 * non-whitespace, empty input counts as zero words rather than one. */
function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** `encoder.encode('')` already returns an empty array, so no special-casing is needed here —
 * this exists to keep the three counts (which come from two different sources) in one call. */
export function countTokens(encoder: Encoder, text: string): TokenCounts {
  return {
    tokens: encoder.encode(text).length,
    characters: text.length,
    words: countWords(text),
  };
}
