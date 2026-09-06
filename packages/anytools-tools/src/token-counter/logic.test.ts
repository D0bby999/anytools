import { describe, expect, it } from 'vitest';
import { countTokens, loadEncoder, modelsForEncoding } from './logic';

describe('loadEncoder + countTokens — real js-tiktoken, real rank tables', () => {
  it('counts "hello world" as 2 tokens under cl100k_base', async () => {
    const encoder = await loadEncoder('cl100k_base');
    const counts = countTokens(encoder, 'hello world');
    // Known cl100k_base token ids for this exact string: [15339, 1917] ("hello", " world").
    expect(encoder.encode('hello world')).toEqual([15339, 1917]);
    expect(counts.tokens).toBe(2);
    expect(counts.characters).toBe(11);
    expect(counts.words).toBe(2);
  });

  it('counts "hello world" as 2 tokens under o200k_base too, with a different token id split', async () => {
    const encoder = await loadEncoder('o200k_base');
    const ids = encoder.encode('hello world');
    expect(ids).toHaveLength(2);
    // o200k_base's vocabulary differs from cl100k_base's, so the ids themselves differ.
    expect(ids).not.toEqual([15339, 1917]);
    expect(countTokens(encoder, 'hello world').tokens).toBe(2);
  });

  it('caches the encoder — the same encoding resolves to the same instance', async () => {
    const first = await loadEncoder('cl100k_base');
    const second = await loadEncoder('cl100k_base');
    expect(second).toBe(first);
  });

  it('a longer sentence tokenizes into more tokens than it has words', async () => {
    // BPE splits punctuation and word-pieces separately, so token count is never below word
    // count for ordinary prose — this just guards against an encoder that returns nonsense.
    const encoder = await loadEncoder('cl100k_base');
    const counts = countTokens(encoder, 'The quick brown fox jumps over the lazy dog.');
    expect(counts.words).toBe(9);
    expect(counts.tokens).toBeGreaterThanOrEqual(counts.words);
  });
});

describe('countTokens — empty input', () => {
  it('returns all zeros for an empty string', async () => {
    const encoder = await loadEncoder('cl100k_base');
    expect(countTokens(encoder, '')).toEqual({ tokens: 0, characters: 0, words: 0 });
  });

  it('does not count whitespace-only input as a word', async () => {
    const encoder = await loadEncoder('cl100k_base');
    expect(countTokens(encoder, '   ').words).toBe(0);
  });
});

describe('modelsForEncoding', () => {
  it('lists GPT-4/3.5-era models for cl100k_base', () => {
    expect(modelsForEncoding('cl100k_base')).toContain('gpt-4');
    expect(modelsForEncoding('cl100k_base')).toContain('gpt-3.5-turbo');
  });

  it('lists GPT-4o/GPT-5-era models for o200k_base', () => {
    expect(modelsForEncoding('o200k_base')).toContain('gpt-4o');
    expect(modelsForEncoding('o200k_base')).toContain('gpt-5');
  });
});
