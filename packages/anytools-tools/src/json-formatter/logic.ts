import JSON5 from 'json5';
import { findUnsafeIntegers } from '../shared/json-unsafe-integers';

export type ParseMode = 'strict' | 'forgiving';

export type ParseError = {
  message: string;
  line?: number;
  col?: number;
  /** Strict parse failed but JSON5 accepts it — the input has comments/trailing commas. */
  json5Ok?: boolean;
};

export type ParseResult =
  | { ok: true; value: unknown; unsafeIntegers: string[] }
  | { ok: false; error: ParseError };

export function parseJson(input: string, mode: ParseMode = 'strict'): ParseResult {
  try {
    const value = mode === 'forgiving' ? JSON5.parse(input) : JSON.parse(input);
    return { ok: true, value, unsafeIntegers: findUnsafeIntegers(input) };
  } catch (e) {
    return {
      ok: false,
      error: mode === 'strict' ? locateWithJson5(e, input) : extractError(e, input),
    };
  }
}

/**
 * V8 changed its JSON.parse message in 2023 from "… at position N" to
 * "Unexpected token '}', "…" is not valid JSON", so on current Chrome and Node the error
 * carries no position at all. JSON5's parser always reports line:col, and its grammar is
 * a superset, so re-parsing with it either yields a located error for the same mistake or
 * tells us the only problem was a comment / trailing comma.
 */
function locateWithJson5(err: unknown, input: string): ParseError {
  const strict = extractError(err, input);
  try {
    JSON5.parse(input);
    return { ...strict, json5Ok: true };
  } catch (e5) {
    if (strict.line) return strict;
    const loose = extractError(e5, input);
    return loose.line ? { message: strict.message, line: loose.line, col: loose.col } : strict;
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
