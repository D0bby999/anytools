export type RegexFlags = {
  global: boolean;
  ignoreCase: boolean;
  multiline: boolean;
  dotAll: boolean;
  unicode: boolean;
  sticky: boolean;
};

export type Match = {
  match: string;
  index: number;
  length: number;
  groups: string[];
  namedGroups: Record<string, string>;
};

export type TestResult =
  | { ok: true; matches: Match[]; replaced?: string }
  | { ok: false; error: string };

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
): { ok: true; re: RegExp } | { ok: false; error: string } {
  try {
    return { ok: true, re: new RegExp(pattern, flagString(flags)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid regex' };
  }
}

export function testRegex(pattern: string, flags: RegexFlags, text: string): TestResult {
  const built = buildRegex(pattern, flags);
  if (!built.ok) return { ok: false, error: built.error };
  const re = built.re;
  const matches: Match[] = [];

  // Catastrophic-backtracking guard: cap iteration count + timeout via Date.now()
  const start = Date.now();
  const HARD_TIMEOUT_MS = 1000;
  const MAX_MATCHES = 10_000;

  try {
    if (!flags.global) {
      const m = re.exec(text);
      if (m) matches.push(toMatch(m));
    } else {
      let m: RegExpExecArray | null;
      // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex iteration
      while ((m = re.exec(text)) !== null) {
        if (Date.now() - start > HARD_TIMEOUT_MS) {
          return {
            ok: false,
            error:
              'Regex execution exceeded 1s — possible catastrophic backtracking. Simplify pattern.',
          };
        }
        matches.push(toMatch(m));
        if (m.index === re.lastIndex) re.lastIndex++; // avoid zero-width infinite loop
        if (matches.length >= MAX_MATCHES) break;
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Regex execution failed' };
  }

  return { ok: true, matches };
}

export function replaceRegex(
  pattern: string,
  flags: RegexFlags,
  text: string,
  replacement: string,
): { ok: true; result: string } | { ok: false; error: string } {
  const built = buildRegex(pattern, flags);
  if (!built.ok) return { ok: false, error: built.error };
  try {
    return { ok: true, result: text.replace(built.re, replacement) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Replace failed' };
  }
}

function toMatch(m: RegExpExecArray): Match {
  return {
    match: m[0],
    index: m.index,
    length: m[0].length,
    groups: m.slice(1).map((g) => g ?? ''),
    namedGroups: m.groups ? { ...m.groups } : {},
  };
}
