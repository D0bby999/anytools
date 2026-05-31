'use client';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  PrivacyNote,
  Textarea,
} from '@anytools/ui';
import { useEffect, useMemo, useState } from 'react';
import { type ParseMode, formatJson, minifyJson, parseJson, sortJsonKeys } from './logic';

type IndentChoice = '2' | '4' | 'tab';

export function JsonFormatterUi() {
  const [input, setInput] = useState('');
  const [indent, setIndent] = useState<IndentChoice>('2');
  const [sortKeys, setSortKeys] = useState(false);
  const [mode, setMode] = useState<ParseMode>('strict');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<{ message: string; line?: number; col?: number } | null>(null);

  const indentValue = useMemo<number | string>(
    () => (indent === 'tab' ? '\t' : Number(indent)),
    [indent],
  );

  useEffect(() => {
    if (input.trim().length === 0) {
      setOutput('');
      setError(null);
      return;
    }
    const parsed = parseJson(input, mode);
    if (!parsed.ok) {
      setOutput('');
      setError(parsed.error);
      return;
    }
    const value = sortKeys ? sortJsonKeys(parsed.value) : parsed.value;
    setOutput(formatJson(value, indentValue));
    setError(null);
  }, [input, indentValue, sortKeys, mode]);

  const doMinify = () => {
    const parsed = parseJson(input, mode);
    if (parsed.ok) setOutput(minifyJson(sortKeys ? sortJsonKeys(parsed.value) : parsed.value));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">JSON Formatter / Validator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Input</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setInput('')}
                disabled={input.length === 0}
              >
                Clear
              </Button>
            </div>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={'{ "hello": "world", "items": [1, 2, 3] }'}
              rows={14}
              aria-label="JSON input"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Output</span>
              {output && <CopyButton text={output} />}
            </div>
            {error ? (
              <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap">
                {error.line ? `Line ${error.line}, col ${error.col}: ` : ''}
                {error.message}
              </output>
            ) : (
              <pre className="rounded-md border bg-muted px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all min-h-[336px]">
                {output || (
                  <span className="text-muted-foreground italic">
                    Valid JSON output will appear here…
                  </span>
                )}
              </pre>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-4 items-center text-sm">
          <span className="text-muted-foreground">Indent:</span>
          {(['2', '4', 'tab'] as IndentChoice[]).map((opt) => (
            <label key={opt} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                checked={indent === opt}
                onChange={() => setIndent(opt)}
                className="h-4 w-4"
              />
              {opt}
            </label>
          ))}
          <label className="flex items-center gap-1 cursor-pointer ml-4">
            <input
              type="checkbox"
              checked={sortKeys}
              onChange={(e) => setSortKeys(e.target.checked)}
              className="h-4 w-4"
            />
            Sort keys (deep)
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={mode === 'forgiving'}
              onChange={(e) => setMode(e.target.checked ? 'forgiving' : 'strict')}
              className="h-4 w-4"
            />
            JSON5 (comments, trailing commas)
          </label>
          <Button variant="outline" size="sm" onClick={doMinify} disabled={!input}>
            Minify
          </Button>
        </div>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
