/**
 * The regex run itself, written to be executed either on the main thread or inside a Web
 * Worker built from this function's own source text (see regex-worker.ts).
 *
 * SELF-CONTAINED ON PURPOSE. `runRegexJob.toString()` becomes the worker script, so nothing in
 * here may reference an import, a module-level constant, or syntax the compiler would rewrite
 * into a helper call (object spread, optional chaining on calls, class fields). Plain ES2020 only.
 */
export type RegexJob = {
  pattern: string;
  flags: string;
  text: string;
  /** When present, the job also computes `text.replace(re, replacement)`. */
  replacement?: string;
  /** Wall-clock budget between matches on the main-thread path; the worker path is terminated. */
  timeoutMs?: number;
  maxMatches?: number;
};

export type RegexJobMatch = {
  match: string;
  index: number;
  length: number;
  groups: string[];
  namedGroups: Record<string, string>;
};

/**
 * Why a job failed. The widget maps a code to its own language; `error` stays the English text.
 * A plain string union rather than a shared constant so the function below stays self-contained.
 */
export type RegexJobErrorCode = 'invalidRegex' | 'timeout' | 'execFailed';

export type RegexJobResult =
  | { ok: true; matches: RegexJobMatch[]; replaced?: string }
  | { ok: false; error: string; code: RegexJobErrorCode };

export function runRegexJob(job: RegexJob): RegexJobResult {
  let re: RegExp;
  try {
    re = new RegExp(job.pattern, job.flags);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Invalid regex',
      code: 'invalidRegex',
    };
  }
  const timeoutMs = job.timeoutMs === undefined ? 1000 : job.timeoutMs;
  const maxMatches = job.maxMatches === undefined ? 10000 : job.maxMatches;
  const matches: RegexJobMatch[] = [];
  const toMatch = (m: RegExpExecArray): RegexJobMatch => {
    const groups: string[] = [];
    for (let i = 1; i < m.length; i++) groups.push(m[i] === undefined ? '' : (m[i] as string));
    const named: Record<string, string> = {};
    if (m.groups) for (const k of Object.keys(m.groups)) named[k] = m.groups[k] ?? '';
    return { match: m[0], index: m.index, length: m[0].length, groups, namedGroups: named };
  };
  const start = Date.now();
  try {
    if (!job.flags.includes('g')) {
      const m = re.exec(job.text);
      if (m) matches.push(toMatch(m));
    } else {
      for (;;) {
        const m = re.exec(job.text);
        if (m === null) break;
        if (Date.now() - start > timeoutMs) {
          return {
            ok: false,
            error:
              'Regex execution exceeded 1s — possible catastrophic backtracking. Simplify pattern.',
            code: 'timeout',
          };
        }
        matches.push(toMatch(m));
        if (m.index === re.lastIndex) re.lastIndex++;
        if (matches.length >= maxMatches) break;
      }
    }
    if (job.replacement === undefined) return { ok: true, matches };
    const replaced = job.text.replace(new RegExp(job.pattern, job.flags), job.replacement);
    return { ok: true, matches, replaced };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Regex execution failed',
      code: 'execFailed',
    };
  }
}
