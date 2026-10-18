import { type RegexJobErrorCode, type RegexJobMatch, runRegexJob } from './regex-job';

export type RegexFlags = {
  global: boolean;
  ignoreCase: boolean;
  multiline: boolean;
  dotAll: boolean;
  unicode: boolean;
  sticky: boolean;
};

export type Match = RegexJobMatch;

export type RegexErrorCode = RegexJobErrorCode;

/** `code` names the failure for the widget's strings table; `error` is the English text. */
export type RegexFailure = { ok: false; error: string; code: RegexErrorCode };

export type TestResult = { ok: true; matches: Match[]; replaced?: string } | RegexFailure;

export function flagString(flags: RegexFlags): string {
  let s = '';
  if (flags.global) s += 'g';
  if (flags.ignoreCase) s += 'i';
  if (flags.multiline) s += 'm';
  if (flags.dotAll) s += 's';
  if (flags.unicode) s += 'u';
  if (flags.sticky) s += 'y';
  return s;
}

export function buildRegex(
  pattern: string,
  flags: RegexFlags,
): { ok: true; re: RegExp } | RegexFailure {
  try {
    return { ok: true, re: new RegExp(pattern, flagString(flags)) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Invalid regex',
      code: 'invalidRegex',
    };
  }
}

export function testRegex(pattern: string, flags: RegexFlags, text: string): TestResult {
  const result = runRegexJob({ pattern, flags: flagString(flags), text });
  return result.ok ? { ok: true, matches: result.matches } : result;
}

export function replaceRegex(
  pattern: string,
  flags: RegexFlags,
  text: string,
  replacement: string,
): { ok: true; result: string } | RegexFailure {
  const result = runRegexJob({ pattern, flags: flagString(flags), text, replacement });
  if (!result.ok) return result;
  return { ok: true, result: result.replaced ?? text };
}
