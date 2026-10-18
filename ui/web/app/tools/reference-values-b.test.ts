// Reference-value cross-check, batch B's part (AnyTools phase 3b). The old
// repo kept every tool's reference values in one reference-values.test.ts; the
// blocks below are its password, bcrypt and url-encode ones, unchanged. The
// calculators' blocks travel with their own batch.
//
// The per-tool logic.test.ts files were written alongside their implementations, so a
// shared misunderstanding would pass both. These values were instead derived
// independently from the published formulas and then compared against the shipped code,
// and each one is a claim the user-facing FAQ copy makes out loud. If a number here
// changes, either the implementation moved or the documentation is now lying.
import { describe, expect, it } from 'vitest';
import { hashPassword, parseCostFactor } from './bcrypt-generator/logic';
import { generatePassword } from './password-generator/logic';
import { decodeUrlComponent } from './url-encode/logic';

describe('password generator — claims vs behaviour', () => {
  const base = {
    length: 20,
    lowercase: true,
    uppercase: true,
    numbers: true,
    symbols: true,
    excludeAmbiguous: false,
  };

  it('reports the real pool sizes so the "~6%" claim can be checked', () => {
    // Sample heavily to observe the alphabet actually in use.
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i++) for (const ch of generatePassword(base)) seen.add(ch);
    const seenNoAmbig = new Set<string>();
    for (let i = 0; i < 4000; i++)
      for (const ch of generatePassword({ ...base, excludeAmbiguous: true })) seenNoAmbig.add(ch);

    const removed = seen.size - seenNoAmbig.size;
    console.log(
      `pool full=${seen.size} without-ambiguous=${seenNoAmbig.size} removed=${removed} ` +
        `= ${((removed / seen.size) * 100).toFixed(1)}%`,
    );
    expect(seen.size).toBeGreaterThan(seenNoAmbig.size);
  });

  it('clamps length to the documented bounds', () => {
    expect(generatePassword({ ...base, length: 1 }).length).toBe(4);
    expect(generatePassword({ ...base, length: 9999 }).length).toBe(256);
  });

  it('throws when every character set is disabled', () => {
    expect(() =>
      generatePassword({
        ...base,
        lowercase: false,
        uppercase: false,
        numbers: false,
        symbols: false,
      }),
    ).toThrow();
  });

  it('quantifies the modulo bias rather than assuming it is zero', () => {
    // bytes[i] % pool.length over a Uint32 source: residues below (2^32 mod pool)
    // are one draw more likely. Report the relative excess.
    for (const pool of [81, 87, 62, 26]) {
      const excess = 2 ** 32 % pool;
      const perResidue = Math.floor(2 ** 32 / pool);
      console.log(
        `pool=${pool}: ${excess} residues get 1 extra draw out of ~${perResidue} ` +
          `-> relative excess ${(1 / perResidue).toExponential(2)}`,
      );
    }
    expect(1 / Math.floor(2 ** 32 / 87)).toBeLessThan(1e-7);
  });
});

describe('numeric claims made in the FAQ copy', () => {
  it('bcrypt: "$2b$10$ followed by 53 characters" — total 60', async () => {
    const h = await hashPassword('correct horse battery staple', 4);
    console.log(`bcrypt hash length=${h.length} prefix=${h.slice(0, 7)} rest=${h.length - 7}`);
    expect(h.length).toBe(60);
    expect(h.length - 7).toBe(53);
    expect(parseCostFactor(h)).toBe(4);
  });
});

describe('url decoding — "+" is a literal, not a space', () => {
  // The FAQ used to claim the decoder accepted "+" as a space. It does not, and
  // should not: "+" only means space inside a form-encoded query string, so a
  // general decoder that converted it would corrupt any path containing one.
  it('leaves "+" alone', () => expect(decodeUrlComponent('hello+world')).toBe('hello+world'));
  it('decodes %20 as a space', () =>
    expect(decodeUrlComponent('hello%20world')).toBe('hello world'));
});
