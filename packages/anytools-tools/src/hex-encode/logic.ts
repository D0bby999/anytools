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

export function decodeHex(input: string): string {
  // Strip 0x prefix, all non-hex chars (spaces, dashes, commas), normalize case
  const clean = input.replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
  if (clean.length === 0) return '';
  if (clean.length % 2 !== 0) throw new Error('Hex string has odd length');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
