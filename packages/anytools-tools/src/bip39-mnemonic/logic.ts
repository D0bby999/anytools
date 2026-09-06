/**
 * BIP-39 mnemonic generate/validate/convert.
 *
 * Uses `@scure/bip39` rather than the older `bip39` package. `bip39@3.1.0` reaches for the bare
 * global `Buffer`, which does not exist in a browser, so running it here meant installing a
 * hand-written Buffer stand-in on `globalThis` — a shim of another library's internals, and a
 * global side effect visible to every other script on the page. `@scure/bip39` is written for
 * the browser: Uint8Array throughout, no Buffer, its only dependency is `@noble/hashes`.
 *
 * English wordlist only this round (see the FAQ). @scure/bip39 ships ten more as separate
 * entry points, so adding them later is a wordlist import, not a rewrite.
 *
 * Entropy source, stated rather than assumed: `generateMnemonic` takes its bytes from
 * `@noble/hashes/utils.randomBytes`, which calls `crypto.getRandomValues` and throws if it is
 * unavailable instead of falling back to `Math.random`.
 *
 * Everything is imported dynamically — the English wordlist alone is ~2000 strings, and no page
 * should pay for it until someone opens this tool.
 */
import { ToolError } from '../shared/tool-error';

export type WordCount = 12 | 15 | 18 | 21 | 24;

export const WORD_COUNTS: WordCount[] = [12, 15, 18, 21, 24];

/** BIP-39 §"Generating the mnemonic": ENT bits = 32 * (words / 3). */
const wordsToStrengthBits = (words: WordCount): number => (words / 3) * 32;

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

async function lib() {
  const [bip39, wordlist] = await Promise.all([
    import('@scure/bip39'),
    import('@scure/bip39/wordlists/english.js'),
  ]);
  return { bip39, words: wordlist.wordlist };
}

export async function generateMnemonicPhrase(words: WordCount): Promise<string> {
  const { bip39, words: wordlist } = await lib();
  return bip39.generateMnemonic(wordlist, wordsToStrengthBits(words));
}

export async function isValidMnemonic(mnemonic: string): Promise<boolean> {
  const { bip39, words: wordlist } = await lib();
  return bip39.validateMnemonic(mnemonic.trim().toLowerCase(), wordlist);
}

export async function mnemonicToEntropyHex(mnemonic: string): Promise<string> {
  const { bip39, words: wordlist } = await lib();
  try {
    return toHex(bip39.mnemonicToEntropy(mnemonic.trim().toLowerCase(), wordlist));
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ToolError('invalidMnemonic', `Invalid mnemonic: ${detail}`, { detail });
  }
}

const ENTROPY_HEX_RE = /^[0-9a-fA-F]+$/;

export async function entropyHexToMnemonicPhrase(entropyHex: string): Promise<string> {
  const clean = entropyHex.trim().toLowerCase();
  if (!ENTROPY_HEX_RE.test(clean) || clean.length % 2 !== 0) {
    throw new ToolError('invalidEntropyHex', 'Entropy must be an even-length hex string.');
  }
  const bytes = clean.length / 2;
  if (bytes < 16 || bytes > 32 || bytes % 4 !== 0) {
    throw new ToolError(
      'invalidEntropyLength',
      `Entropy must be 16, 20, 24, 28 or 32 bytes (128–256 bits); got ${bytes}.`,
      { bytes },
    );
  }
  const { bip39, words: wordlist } = await lib();
  const raw = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) raw[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bip39.entropyToMnemonic(raw, wordlist);
}

export async function mnemonicToSeedHex(mnemonic: string, passphrase = ''): Promise<string> {
  const { bip39, words: wordlist } = await lib();
  const normalized = mnemonic.trim().toLowerCase();
  if (!bip39.validateMnemonic(normalized, wordlist)) {
    throw new ToolError('invalidMnemonic', 'Invalid mnemonic: failed the BIP-39 checksum.');
  }
  return toHex(bip39.mnemonicToSeedSync(normalized, passphrase));
}
