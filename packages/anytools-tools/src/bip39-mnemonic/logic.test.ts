// @vitest-environment node
// bip39's default RNG calls crypto.getRandomValues, and mnemonicToSeedSync uses WebCrypto-backed
// PBKDF2 (@noble/hashes) — real WebCrypto is required, which happy-dom does not provide.
//
// Vectors below are the official BIP-39 test vectors (bitcoin/bip39 `vectors.json`, the
// all-zero-entropy and all-ones-entropy rows), not values this test computed itself — a
// generate-then-validate-the-same-output round trip would be circular.
import { describe, expect, it } from 'vitest';
import {
  entropyHexToMnemonicPhrase,
  generateMnemonicPhrase,
  isValidMnemonic,
  mnemonicToEntropyHex,
  mnemonicToSeedHex,
} from './logic';

const ZERO_ENTROPY_128 = '00000000000000000000000000000000'.slice(0, 32);
const ZERO_MNEMONIC_12 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
// Official vector's expected seed for ZERO_MNEMONIC_12 with passphrase "TREZOR".
const ZERO_SEED_TREZOR =
  'c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04';

const ONES_ENTROPY_256 = 'f'.repeat(64);
const ONES_MNEMONIC_24 =
  'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote';

describe('mnemonic <-> entropy — official BIP-39 vectors', () => {
  it('turns all-zero 128-bit entropy into the canonical "abandon...about" phrase', async () => {
    expect(await entropyHexToMnemonicPhrase(ZERO_ENTROPY_128)).toBe(ZERO_MNEMONIC_12);
  });

  it('recovers the same entropy back from that phrase', async () => {
    expect(await mnemonicToEntropyHex(ZERO_MNEMONIC_12)).toBe(ZERO_ENTROPY_128);
  });

  it('turns all-ones 256-bit entropy into the canonical 24-word "zoo...vote" phrase', async () => {
    expect(await entropyHexToMnemonicPhrase(ONES_ENTROPY_256)).toBe(ONES_MNEMONIC_24);
  });

  it('derives the exact official seed for the zero mnemonic with passphrase "TREZOR"', async () => {
    expect(await mnemonicToSeedHex(ZERO_MNEMONIC_12, 'TREZOR')).toBe(ZERO_SEED_TREZOR);
  });
});

describe('isValidMnemonic', () => {
  it('accepts a checksum-valid phrase', async () => {
    expect(await isValidMnemonic(ZERO_MNEMONIC_12)).toBe(true);
  });

  it('rejects a phrase with a bad checksum (last word swapped)', async () => {
    const tampered = ZERO_MNEMONIC_12.replace(/about$/, 'zoo');
    expect(await isValidMnemonic(tampered)).toBe(false);
  });

  it('rejects a phrase containing a word outside the wordlist', async () => {
    expect(await isValidMnemonic('abandon abandon notaword')).toBe(false);
  });

  it('is case- and whitespace-insensitive', async () => {
    expect(await isValidMnemonic(`  ${ZERO_MNEMONIC_12.toUpperCase()}  `)).toBe(true);
  });
});

describe('generateMnemonicPhrase', () => {
  it.each([12, 15, 18, 21, 24] as const)('generates a valid %d-word phrase', async (words) => {
    const phrase = await generateMnemonicPhrase(words);
    expect(phrase.split(' ')).toHaveLength(words);
    expect(await isValidMnemonic(phrase)).toBe(true);
  });

  it('draws fresh entropy each call (not the same phrase twice in a row)', async () => {
    const a = await generateMnemonicPhrase(12);
    const b = await generateMnemonicPhrase(12);
    expect(a).not.toBe(b);
  });
});

describe('input validation errors', () => {
  it('rejects entropy hex of the wrong length', async () => {
    await expect(entropyHexToMnemonicPhrase('ab')).rejects.toThrow(/16, 20, 24, 28 or 32 bytes/);
  });

  it('rejects non-hex entropy input', async () => {
    await expect(entropyHexToMnemonicPhrase('not-hex-zzzz')).rejects.toThrow(/hex string/);
  });

  it('rejects mnemonicToEntropyHex on a checksum-invalid phrase', async () => {
    const tampered = ZERO_MNEMONIC_12.replace(/about$/, 'zoo');
    await expect(mnemonicToEntropyHex(tampered)).rejects.toThrow(/Invalid mnemonic/);
  });

  it('rejects mnemonicToSeedHex on a checksum-invalid phrase', async () => {
    const tampered = ZERO_MNEMONIC_12.replace(/about$/, 'zoo');
    await expect(mnemonicToSeedHex(tampered)).rejects.toThrow(/checksum/);
  });
});
