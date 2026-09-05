/**
 * JSON.parse turns every number into an IEEE double, so an integer above 2^53 comes back
 * rounded: 12345678901234567890 → 12345678901234567000. The tools built on JSON.parse
 * (formatter, diff) cannot avoid that without a different parser, but they can at least
 * say so instead of quietly rewriting an ID. This scans the raw text for integer literals
 * outside strings (and outside JSON5 comments) that would not survive the round trip.
 */
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export function findUnsafeIntegers(text: string): string[] {
  const found: string[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i] as string;
    if (ch === '"' || ch === "'") {
      // Skip a string literal, honouring backslash escapes.
      const quote = ch;
      i++;
      while (i < n && text[i] !== quote) i += text[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (j < n && (text[j] as string) >= '0' && (text[j] as string) <= '9') j++;
      const digits = text.slice(i, j);
      const next = text[j];
      // A fraction or exponent makes it a float; those round for other reasons and are out of scope.
      const isInteger = next !== '.' && next !== 'e' && next !== 'E';
      const prevIsWordChar = i > 0 && /[\w.]/.test(text[i - 1] as string);
      if (isInteger && !prevIsWordChar && BigInt(digits) > MAX_SAFE) {
        found.push(text[i - 1] === '-' ? `-${digits}` : digits);
      }
      i = j;
      continue;
    }
    i++;
  }
  return found;
}
