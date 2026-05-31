import JSON5 from 'json5';

export type ParseMode = 'strict' | 'forgiving';

export type ParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { message: string; line?: number; col?: number } };

export function parseJson(input: string, mode: ParseMode = 'strict'): ParseResult {
  try {
    const value = mode === 'forgiving' ? JSON5.parse(input) : JSON.parse(input);
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: extractError(e, input) };
  }
}

function extractError(
  err: unknown,
  input: string,
): { message: string; line?: number; col?: number } {
  const message = err instanceof Error ? err.message : 'Parse error';
  // Try to find "at position N" in native JSON.parse messages
  const posMatch = /at position (\d+)/.exec(message);
  if (posMatch) {
    const pos = Number(posMatch[1]);
    const { line, col } = positionToLineCol(input, pos);
    return { message, line, col };
  }
  // JSON5 errors include line/column directly
  const lineMatch = /at (\d+):(\d+)/.exec(message);
  if (lineMatch) {
    return { message, line: Number(lineMatch[1]), col: Number(lineMatch[2]) };
  }
  return { message };
}

function positionToLineCol(text: string, pos: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

export function formatJson(value: unknown, indent: number | string = 2): string {
  return JSON.stringify(value, null, indent);
}

export function minifyJson(value: unknown): string {
  return JSON.stringify(value);
}

export function sortJsonKeys(value: unknown, deep = true): unknown {
  if (Array.isArray(value)) {
    return deep ? value.map((v) => sortJsonKeys(v, deep)) : value;
  }
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = deep
        ? sortJsonKeys((value as Record<string, unknown>)[key], deep)
        : (value as Record<string, unknown>)[key];
    }
    return sorted;
  }
  return value;
}
