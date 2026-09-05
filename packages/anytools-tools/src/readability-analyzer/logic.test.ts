import { describe, expect, it } from 'vitest';
import { READING_LEVEL_NAMES, analyze, complexWords, syllables } from './logic';

describe('syllables', () => {
  it('counts single syllable words', () => {
    expect(syllables('cat')).toBe(1);
    expect(syllables('run')).toBe(1);
  });

  it('counts multi-syllable words', () => {
    expect(syllables('beautiful')).toBe(3);
    expect(syllables('education')).toBe(4);
  });

  it('handles silent -e', () => {
    // "simple" without silent-e rule would be 3 vowel groups; should be 2
    expect(syllables('simple')).toBe(2);
  });

  it('returns at least 1 for any word', () => {
    expect(syllables('x')).toBe(1);
  });
});

describe('complexWords', () => {
  it('counts words with 3+ syllables', () => {
    expect(complexWords(['cat', 'beautiful', 'education', 'run'])).toBe(2);
  });

  it('returns 0 for all simple words', () => {
    expect(complexWords(['the', 'cat', 'sat'])).toBe(0);
  });
});

describe('analyze', () => {
  it('returns null for empty string', () => {
    expect(analyze('')).toBeNull();
    expect(analyze('   ')).toBeNull();
  });

  it('computes basic counts for a simple sentence', () => {
    const r = analyze('The cat sat on the mat.');
    expect(r).not.toBeNull();
    expect(r!.words).toBe(6);
    expect(r!.sentences).toBe(1);
  });

  it('flesch score is higher (easier) for simple text', () => {
    const simple = analyze('The cat sat. Dogs run. Birds fly.')!;
    const complex = analyze(
      'The implementation of sophisticated computational methodologies necessitates comprehensive evaluation.',
    )!;
    expect(simple.flesch).toBeGreaterThan(complex.flesch);
  });

  it('fkGrade is never negative', () => {
    const r = analyze('Go. Run. Sit. Stop.')!;
    expect(r.fkGrade).toBeGreaterThanOrEqual(0);
  });

  it('fog is never negative', () => {
    const r = analyze('Hi. Bye.')!;
    expect(r.fog).toBeGreaterThanOrEqual(0);
  });

  it('assigns correct reading level for very simple text', () => {
    // Short simple words → high flesch score → 6th grade or 7th grade level
    const r = analyze('Go. Run. Jump. Sit. Play. Stop. Walk. Eat. Drink. Sleep.')!;
    expect(['6th grade', '7th grade', '8th–9th grade', 'Universal']).toContain(r.level);
  });

  it('tags the level with an id the widget can translate', () => {
    const r = analyze('Go. Run. Jump. Sit. Play. Stop. Walk. Eat. Drink. Sleep.')!;
    expect(READING_LEVEL_NAMES[r.levelId]).toBe(r.level);
    const hard = analyze(
      'Notwithstanding the aforementioned considerations, institutional epistemological frameworks necessitate comprehensive reconceptualization.',
    )!;
    expect(hard.levelId).toBe('collegeGraduate');
    expect(hard.level).toBe('College graduate');
  });

  it('Flesch formula matches manual calculation', () => {
    // One sentence, three one-syllable words: "Cats eat fish."
    // words=3, sentences=1, syllables=3
    // wordsPerSentence=3, sylPerWord=1
    // flesch = 206.835 - 1.015*3 - 84.6*1 = 206.835 - 3.045 - 84.6 = 119.19
    const r = analyze('Cats eat fish.')!;
    expect(r.flesch).toBeCloseTo(206.835 - 1.015 * 3 - 84.6 * 1, 0);
  });
});
