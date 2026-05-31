'use client';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  PrivacyNote,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { csvToJson, jsonToCsv } from './logic';

type Mode = 'csv-to-json' | 'json-to-csv';

export function CsvJsonUi() {
  const [mode, setMode] = useState<Mode>('csv-to-json');
  const [input, setInput] = useState('');
  const [hasHeader, setHasHeader] = useState(true);

  const result = useMemo(() => {
    if (!input.trim()) return { ok: true as const, value: '' };
    try {
      if (mode === 'csv-to-json') {
        const data = csvToJson(input, { header: hasHeader });
        return { ok: true as const, value: JSON.stringify(data, null, 2) };
      }
      const data = JSON.parse(input);
      return { ok: true as const, value: jsonToCsv(data) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Convert failed' };
    }
  }, [input, mode, hasHeader]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">CSV ↔ JSON Converter</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList>
            <TabsTrigger value="csv-to-json">CSV → JSON</TabsTrigger>
            <TabsTrigger value="json-to-csv">JSON → CSV</TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === 'csv-to-json' && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hasHeader}
              onChange={(e) => setHasHeader(e.target.checked)}
              className="h-4 w-4"
            />
            First row is header
          </label>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              Input
            </span>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                mode === 'csv-to-json' ? 'name,age\nAlice,30' : '[{"name":"Alice","age":30}]'
              }
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
