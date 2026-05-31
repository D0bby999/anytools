export function encodeBinary(text: string, separator = ' '): string {
  if (!text) return '';
  const bytes = new TextEncoder().encode(text);
  return Array.from(bytes)
    .map((b) => b.toString(2).padStart(8, '0'))
    .join(separator);
}

export function decodeBinary(input: string): string {
  const clean = input.replace(/[^01]/g, '');
  if (clean.length === 0) return '';
  if (clean.length % 8 !== 0) throw new Error('Binary string length must be a multiple of 8');
  const bytes = new Uint8Array(clean.length / 8);
  for (let i = 0; i < clean.length; i += 8) {
    bytes[i / 8] = Number.parseInt(clean.slice(i, i + 8), 2);
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
