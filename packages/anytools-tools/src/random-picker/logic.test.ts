import { describe, expect, it } from 'vitest';
import { flipCoin, parseListItems, pickOne, randomInt, rollDice } from './logic';

// Deterministic RNG sequences for testing
const makeSeq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
};

describe('rollDice', () => {
  it('returns correct number of rolls', () => {
    const { rolls } = rollDice(3, 6, makeSeq(0.5, 0.5, 0.5));
    expect(rolls).toHaveLength(3);
  });

  it('roll values are within [1, sides]', () => {
    // rng returns 0 → floor(0*6)+1 = 1; returns 0.999 → floor(5.994)+1 = 6
    const { rolls: min } = rollDice(5, 6, makeSeq(0));
    const { rolls: max } = rollDice(5, 6, makeSeq(0.9999));
    expect(min.every((r) => r === 1)).toBe(true);
    expect(max.every((r) => r === 6)).toBe(true);
  });

  it('sum equals sum of individual rolls', () => {
    const { rolls, sum } = rollDice(4, 6, makeSeq(0.1, 0.3, 0.5, 0.9));
    expect(sum).toBe(rolls.reduce((a, b) => a + b, 0));
  });

  it('same elements after re-roll — length preserved', () => {
    const count = 10;
    const { rolls } = rollDice(count, 20, Math.random);
    expect(rolls).toHaveLength(count);
    expect(rolls.every((r) => r >= 1 && r <= 20)).toBe(true);
  });
});

describe('flipCoin', () => {
  it('returns Heads when rng < 0.5', () => {
    expect(flipCoin(makeSeq(0.49))).toBe('Heads');
  });

  it('returns Tails when rng >= 0.5', () => {
    expect(flipCoin(makeSeq(0.5))).toBe('Tails');
    expect(flipCoin(makeSeq(0.99))).toBe('Tails');
  });
});

describe('randomInt', () => {
  it('returns min when rng returns 0', () => {
    expect(randomInt(5, 10, makeSeq(0))).toBe(5);
  });

  it('returns max when rng returns just below 1', () => {
    expect(randomInt(5, 10, makeSeq(0.9999))).toBe(10);
  });

  it('swaps min and max when min > max', () => {
    // Should not throw; result in [3, 7]
    const result = randomInt(7, 3, makeSeq(0.5));
    expect(result).toBeGreaterThanOrEqual(3);
    expect(result).toBeLessThanOrEqual(7);
  });

  it('returns the only value when min === max', () => {
    expect(randomInt(5, 5, makeSeq(0.5))).toBe(5);
  });
});

describe('pickOne', () => {
  it('returns undefined for empty array', () => {
    expect(pickOne([], Math.random)).toBeUndefined();
  });

  it('picks the correct index based on rng', () => {
    const items = ['A', 'B', 'C'];
    // rng=0 → index 0; rng=0.9999 → index 2
    expect(pickOne(items, makeSeq(0))).toBe('A');
    expect(pickOne(items, makeSeq(0.9999))).toBe('C');
  });

  it('always returns an element that is in the input array', () => {
    const items = ['X', 'Y', 'Z'];
    for (let i = 0; i < 20; i++) {
      expect(items).toContain(pickOne(items));
    }
  });
});

describe('parseListItems', () => {
  it('splits on newlines and trims whitespace', () => {
    expect(parseListItems('Alice\n  Bob  \nCharlie')).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('filters out blank lines', () => {
    expect(parseListItems('A\n\nB\n  \nC')).toEqual(['A', 'B', 'C']);
  });

  it('returns empty array for blank string', () => {
    expect(parseListItems('')).toEqual([]);
    expect(parseListItems('\n\n')).toEqual([]);
  });
});
