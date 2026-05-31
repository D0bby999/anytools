'use client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  PrivacyNote,
  Textarea,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { formatYaml } from './logic';

export function YamlFormatterUi() {
  const [input, setInput] = useState('');
  const [indent, setIndent] = useState<2 | 4>(2);
  const [sortKeys, setSortKeys] = useState(false);

  const result = useMemo(() => {
    if (!input.trim()) return { ok: true as const, value: '' };
    return formatYaml(input, indent, sortKeys);
  }, [input, indent, sortKeys]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">YAML Formatter / Validator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center text-sm">
          <label className="flex items-center gap-1">
            Indent:
            <select
              value={indent}
              onChange={(e) => setIndent(Number(e.target.value) as 2 | 4)}
              className="h-8 rounded border border-input bg-background px-2"
            >
              <option value={2}>2 spaces</option>
              <option value={4}>4 spaces</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={sortKeys}
              onChange={(e) => setSortKeys(e.target.checked)}
              className="h-4 w-4"
            />
            Sort keys
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              Input
            </span>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="key: value\nlist:\n  - item"
              rows={12}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Output</span>
              {result.ok && result.value && <CopyButton text={result.value} />}
            </div>
            {result.ok ? (
              <pre className="rounded-md border bg-muted px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all min-h-[280px]">
                {result.value || <span className="text-muted-foreground italic">—</span>}
              </pre>
            ) : (
              <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {result.error}
              </output>
            )}
          </div>
        </div>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
