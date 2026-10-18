import { ToolError } from '../shared/tool-error';

export function encodeBinary(text: string, separator = ' '): string {
  if (!text) return '';
  const bytes = new TextEncoder().encode(text);
  return Array.from(bytes)
    .map((b) => b.toString(2).padStart(8, '0'))
    .join(separator);
}

// Whatever people put between bytes: whitespace, commas, dashes, pipes, colons, underscores.
const SEPARATORS = /[\s,;:|_-]/g;
// A `0b` prefix ahead of a byte, as printed by most languages.
const BINARY_PREFIX = /0b(?=[01])/gi;

export function decodeBinary(input: string): string {
  const clean = input.replace(BINARY_PREFIX, '').replace(SEPARATORS, '');
  if (clean.length === 0) return '';
  // Previously every non-01 character was dropped silently, so "hello" decoded to "" with no
  // hint that nothing had been read. Anything left that isn't a bit is now an error.
  const bad = clean.match(/[^01]/);
  if (bad) {
    throw new ToolError(
      'notBinaryDigit',
      `"${bad[0]}" is not a binary digit — expected only 0 and 1`,
      {
        char: bad[0],
      },
    );
  }
  if (clean.length % 8 !== 0) {
    throw new ToolError('binaryLength', 'Binary string length must be a multiple of 8');
  }
  const bytes = new Uint8Array(clean.length / 8);
  for (let i = 0; i < clean.length; i += 8) {
    bytes[i / 8] = Number.parseInt(clean.slice(i, i + 8), 2);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
