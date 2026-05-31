export type EscapeMode = 'json' | 'es6' | 'all';

export type EscapeOptions = {
  mode?: EscapeMode;
  uppercase?: boolean;
};

const isAsciiPrintable = (cp: number) => cp >= 0x20 && cp <= 0x7e;

export function escapeUnicode(text: string, options: EscapeOptions = {}): string {
  if (!text) return '';
  const mode = options.mode ?? 'json';
  const upper = options.uppercase ?? false;
  const hex = (n: number, width: number) => {
    const s = n.toString(16).padStart(width, '0');
    return upper ? s.toUpperCase() : s;
  };

  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    const shouldEscape = mode === 'all' || !isAsciiPrintable(cp);
    if (!shouldEscape) {
      out += ch;
      continue;
    }
    if (mode === 'es6' && cp > 0xffff) {
      out += `\\u{${hex(cp, 0)}}`;
    } else if (cp > 0xffff) {
      // Surrogate pair for JSON / strict UTF-16
      const high = 0xd800 + ((cp - 0x10000) >> 10);
      const low = 0xdc00 + ((cp - 0x10000) & 0x3ff);
      out += `\\u${hex(high, 4)}\\u${hex(low, 4)}`;
    } else {
      out += `\\u${hex(cp, 4)}`;
    }
  }
  return out;
}

export function unescapeUnicode(text: string): string {
  if (!text) return '';
  // \u{XXXXX} first (greedy hex), then \uXXXX
  return text
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_m, hex) => {
      const cp = Number.parseInt(hex, 16);
      if (cp > 0x10ffff) throw new Error(`Invalid code point: ${hex}`);
      return String.fromCodePoint(cp);
    })
    .replace(/\\u([0-9a-fA-F]{4})\\u([0-9a-fA-F]{4})/g, (m, h1, h2) => {
      const high = Number.parseInt(h1, 16);
      const low = Number.parseInt(h2, 16);
      if (high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff) {
        const cp = ((high - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
        return String.fromCodePoint(cp);
      }
      return m;
    })
    .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}
