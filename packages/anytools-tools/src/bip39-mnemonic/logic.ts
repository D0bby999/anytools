/**
 * BIP-39 mnemonic generate/validate/convert, using the `bip39` package (imported dynamically —
 * it pulls in `@noble/hashes`).
 *
 * English wordlist only this round (see the FAQ). Entropy source: verified by reading
 * `bip39@3.1.0`'s own source — `generateMnemonic`'s default `rng` is
 * `(size) => Buffer.from(@noble/hashes/utils.randomBytes(size))`, and that `randomBytes` calls
 * `crypto.getRandomValues` (throwing rather than falling back to `Math.random` if it is
 * unavailable). So the library default is already the secure source this tool requires, and no
 * override is needed — this is stated rather than assumed, per the phase brief.
 *
 * `bip39` references the bare global `Buffer` (`Buffer.from`, `Buffer.isBuffer`,
 * `.toString('hex')`) with no import of its own, which is fine in Node but does not exist in a
 * browser — and nothing else in this app polyfills it (`buffer`, the npm polyfill package, is
 * only a transitive dependency elsewhere in the lockfile, not one `@anytools/tools` can import).
 * `ensureBufferPolyfill` below installs a minimal `Uint8Array`-backed stand-in covering exactly
 * the surface `bip39` touches — verified against `bip39/src/index.js` — before any bip39
 * function runs.
 */
import { ToolError } from '../shared/tool-error';

// Deliberately does NOT declare a `static from`/`static isBuffer` in the class body: Uint8Array
// already has an incompatible static `from`, and TS (rightly) refuses to let a subclass narrow
// it. bip39 only ever calls `Buffer.from(...)`/`Buffer.isBuffer(...)` as plain function calls on
// whatever object `global.Buffer` is — never `new Buffer()` — so the global polyfill below is
// assembled as a plain object instead of relying on class statics.
class BufferPolyfill extends Uint8Array {
  override toString(encoding?: 'utf8' | 'hex'): string {
    if (encoding === 'hex')
      return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join('');
    return new TextDecoder().decode(this);
  }
}

function bufferFrom(input: string | ArrayLike<number>, encoding?: 'utf8' | 'hex'): BufferPolyfill {
  if (typeof input === 'string') {
    if (encoding === 'hex') {
      const clean = input.length % 2 ? `0${input}` : input;
      const bytes = new Uint8Array(clean.length / 2);
      for (let i = 0; i < bytes.length; i++)
        bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
      return new BufferPolyfill(bytes);
    }
    return new BufferPolyfill(new TextEncoder().encode(input));
  }
  return new BufferPolyfill(input);
}

function ensureBufferPolyfill(): void {
  const g = globalThis as unknown as { Buffer?: unknown };
  if (typeof g.Buffer !== 'undefined') return;
  g.Buffer = {
    from: bufferFrom,
    isBuffer: (x: unknown): x is BufferPolyfill => x instanceof BufferPolyfill,
  };
}

export type WordCount = 12 | 15 | 18 | 21 | 24;
export const WORD_COUNTS: WordCount[] = [12, 15, 18, 21, 24];
/** BIP-39 §"Generating the mnemonic": ENT bits = 32 * (words / 3). */
const wordsToStrengthBits = (words: WordCount): number => (words / 3) * 32;

export async function generateMnemonicPhrase(words: WordCount): Promise<string> {
  ensureBufferPolyfill();
  const bip39 = await import('bip39');
  return bip39.generateMnemonic(wordsToStrengthBits(words));
}

export async function isValidMnemonic(mnemonic: string): Promise<boolean> {
  ensureBufferPolyfill();
  const bip39 = await import('bip39');
  return bip39.validateMnemonic(mnemonic.trim().toLowerCase());
}

export async function mnemonicToEntropyHex(mnemonic: string): Promise<string> {
  ensureBufferPolyfill();
  const bip39 = await import('bip39');
  const normalized = mnemonic.trim().toLowerCase();
  try {
    return bip39.mnemonicToEntropy(normalized);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new ToolError('invalidMnemonic', `Invalid mnemonic: ${detail}`, { detail });
  }
}

const ENTROPY_HEX_RE = /^[0-9a-fA-F]+$/;

export async function entropyHexToMnemonicPhrase(entropyHex: string): Promise<string> {
  ensureBufferPolyfill();
  const bip39 = await import('bip39');
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
  return bip39.entropyToMnemonic(clean);
}

export async function mnemonicToSeedHex(mnemonic: string, passphrase = ''): Promise<string> {
  ensureBufferPolyfill();
  const bip39 = await import('bip39');
  const normalized = mnemonic.trim().toLowerCase();
  if (!bip39.validateMnemonic(normalized)) {
    throw new ToolError('invalidMnemonic', 'Invalid mnemonic: failed the BIP-39 checksum.');
  }
  const seed = bip39.mnemonicToSeedSync(normalized, passphrase);
  return Array.from(seed, (b) => b.toString(16).padStart(2, '0')).join('');
}
