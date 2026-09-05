import { ToolError } from '../shared/tool-error';

export type HexFormat = {
  separator?: string;
  prefix?: string;
  uppercase?: boolean;
};

export function encodeHex(text: string, format: HexFormat = {}): string {
  if (!text) return '';
  const bytes = new TextEncoder().encode(text);
  const sep = format.separator ?? ' ';
  const prefix = format.prefix ?? '';
  const upper = format.uppercase ?? false;
  return Array.from(bytes)
    .map((b) => {
      const hex = b.toString(16).padStart(2, '0');
      return prefix + (upper ? hex.toUpperCase() : hex);
    })
    .join(sep);
}

// Whatever people put between bytes: whitespace, commas, dashes, pipes, colons, underscores.
const SEPARATORS = /[\s,;:|_-]/g;

export function decodeHex(input: string): string {
  // Strip 0x prefixes and byte separators, normalize case
  const clean = input.replace(/0x/gi, '').replace(SEPARATORS, '');
  if (clean.length === 0) return '';
  // Previously every non-hex character was dropped silently, so "xyz" decoded to "" with no
  // hint that nothing had been read. Anything left that isn't a hex digit is now an error.
  const bad = clean.match(/[^0-9a-fA-F]/);
  if (bad) {
    throw new ToolError('notHexDigit', `"${bad[0]}" is not a hex digit — expected 0-9 and a-f`, {
      char: bad[0],
    });
  }
  if (clean.length % 2 !== 0) throw new ToolError('hexOddLength', 'Hex string has odd length');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
