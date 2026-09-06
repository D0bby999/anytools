// @vitest-environment node
/**
 * Runs the REAL jq-wasm library end to end — `runJqDirect(input, query)` with no `wasmUrl`
 * override takes jq-wasm's own Node platform default, which reads the binary straight off disk
 * (no fetch, no browser). This is the same jq WASM binary and JS surface the browser Worker
 * uses; only the byte-loading path differs, which is exactly the part this file is NOT trying to
 * test (that part is the mandatory browser lane in the phase file's Verify section).
 */
import { describe, expect, it } from 'vitest';
import { ToolError } from '../shared/tool-error';
import { JQ_EXAMPLES, MAX_JQ_INPUT_BYTES, runJqDirect, validateJqInputSize } from './logic';

describe('JQ_EXAMPLES', () => {
  it('every curated example runs and produces the expected jq output', async () => {
    const expected: Record<string, string> = {
      field: '42',
      select: '{"name":"Alice","age":31}\n{"name":"Cara","age":42}',
      map: '[2,4,6,8,10]',
      group_by: '[[{"team":"A","score":3},{"team":"A","score":5}],[{"team":"B","score":1}]]',
      to_entries: '[{"key":"a","value":1},{"key":"b","value":2},{"key":"c","value":3}]',
    };
    for (const example of JQ_EXAMPLES) {
      // '-c' (compact, one JSON value per line) so the assertion doesn't have to reimplement
      // jq's own pretty-printer; the real UI calls runJqDirect with the default (pretty) flags.
      const result = await runJqDirect(example.input, example.query, undefined, ['-c']);
      expect(result.ok, `${example.id} failed: ${JSON.stringify(result)}`).toBe(true);
      if (!result.ok) continue;
      expect(result.stdout).toBe(expected[example.id]);
    }
  });

  it('has at least the 5 filter shapes the phase spec calls out', () => {
    const ids = JQ_EXAMPLES.map((e) => e.id);
    for (const must of ['field', 'select', 'map', 'group_by', 'to_entries']) {
      expect(ids).toContain(must);
    }
  });
});

describe('runJqDirect', () => {
  it('returns a plain field lookup', async () => {
    const result = await runJqDirect('{"a": {"b": 7}}', '.a.b');
    expect(result).toEqual({ ok: true, stdout: '7', stderr: '' });
  });

  it("surfaces jq's own syntax error verbatim, unmodified", async () => {
    const result = await runJqDirect('{}', 'this is not [[[ valid jq');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalidQuery');
    // The real jq compiler's own wording — not a message this codebase wrote.
    expect(result.error).toContain('syntax error');
  });

  it("surfaces invalid JSON input as jq's own parse error", async () => {
    const result = await runJqDirect('{not valid json', '.');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeGreaterThan(0);
  });

  it('rejects an empty filter before touching jq at all', async () => {
    const result = await runJqDirect('{}', '   ');
    expect(result).toEqual({ ok: false, error: 'Filter is empty', code: 'invalidQuery' });
  });
});

describe('validateJqInputSize', () => {
  it('accepts input at or under the cap', () => {
    expect(() => validateJqInputSize('x'.repeat(1000))).not.toThrow();
  });

  it('throws a ToolError over the cap, naming the megabyte ceiling', () => {
    const big = 'x'.repeat(MAX_JQ_INPUT_BYTES + 1);
    try {
      validateJqInputSize(big);
      throw new Error('expected validateJqInputSize to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ToolError);
      expect((e as ToolError).code).toBe('inputTooLarge');
      expect((e as ToolError).message).toContain('5 MB');
    }
  });
});
