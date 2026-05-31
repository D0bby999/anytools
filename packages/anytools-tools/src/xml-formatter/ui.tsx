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
import { useMemo, useState } from 'react';
import { formatXml, minifyXml } from './logic';

export function XmlFormatterUi() {
  const [input, setInput] = useState('');
  const [indent, setIndent] = useState<2 | 4>(2);
  const [minified, setMinified] = useState(false);

  const result = useMemo(() => {
    if (!input.trim()) return { ok: true as const, value: '' };
    return minified ? minifyXml(input) : formatXml(input, indent);
  }, [input, indent, minified]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">XML Formatter / Validator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-center text-sm">
          <label className="flex items-center gap-1">
            Indent:
            <select
              value={indent}
              onChange={(e) => setIndent(Number(e.target.value) as 2 | 4)}
              disabled={minified}
              className="h-8 rounded border border-input bg-background px-2"
            >
              <option value={2}>2 spaces</option>
              <option value={4}>4 spaces</option>
            </select>
          </label>
          <Button
            variant={minified ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMinified((v) => !v)}
          >
            {minified ? 'Minify ON' : 'Minify OFF'}
          </Button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              Input
            </span>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="<root>...</root>"
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
