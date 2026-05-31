import { getAddress, isAddress } from 'ethers';

export type WalletKind = 'eth' | 'btc' | 'sol' | 'unknown';

export type WalletInspection =
  | { valid: true; kind: WalletKind; canonical: string; checksum?: boolean; subtype?: string }
  | { valid: false; kind: 'unknown'; error: string };

const BTC_LEGACY = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/;
const BTC_BECH32 = /^(bc1|tb1)[a-zA-HJ-NP-Z0-9]{25,62}$/;
const SOL_BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function inspect(address: string): WalletInspection {
  const trimmed = address.trim();
  if (trimmed.length === 0) return { valid: false, kind: 'unknown', error: 'Empty input' };

  // ETH (and other EVM chains share the format)
  if (/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    if (isAddress(trimmed)) {
      const canonical = getAddress(trimmed);
      const checksumValid = trimmed === canonical || trimmed === trimmed.toLowerCase();
      return {
        valid: true,
        kind: 'eth',
        canonical,
        checksum: trimmed === canonical,
        subtype: checksumValid ? 'EVM (EIP-55 valid)' : 'EVM (checksum mismatch)',
      };
    }
    return { valid: false, kind: 'unknown', error: 'Invalid EVM checksum' };
  }

  // BTC native segwit (bech32) — distinctive prefix, check first
  if (BTC_BECH32.test(trimmed.toLowerCase())) {
    return {
      valid: true,
      kind: 'btc',
      canonical: trimmed.toLowerCase(),
      subtype: 'bech32 (native segwit)',
    };
  }
  // SOL base58 — disambiguate from BTC legacy by length.
  // BTC legacy = 26-34 chars; SOL = 32-44 chars. 32-34 overlap → prefer SOL
  // when length > 34 (unambiguous SOL) OR length ≥ 32 and not starting with 1/3 (BTC prefix).
  if (SOL_BASE58.test(trimmed)) {
    if (trimmed.length > 34) {
      return { valid: true, kind: 'sol', canonical: trimmed };
    }
    if (trimmed.length >= 32 && !/^[13]/.test(trimmed)) {
      return { valid: true, kind: 'sol', canonical: trimmed };
    }
    // 32-34 chars starting with 1 or 3 — ambiguous. SOL well-known accounts
    // (system program "111...", etc.) are the common case at length 32.
    if (trimmed.length === 32) {
      return { valid: true, kind: 'sol', canonical: trimmed };
    }
  }
  // BTC legacy / segwit-wrapped
  if (BTC_LEGACY.test(trimmed)) {
    return {
      valid: true,
      kind: 'btc',
      canonical: trimmed,
      subtype: trimmed.startsWith('1') ? 'legacy (P2PKH)' : 'segwit-wrapped (P2SH)',
    };
  }

  return { valid: false, kind: 'unknown', error: 'Unrecognized address format' };
}
