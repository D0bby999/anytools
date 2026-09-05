'use client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Textarea,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useEffect, useState } from 'react';
import { type Target, convertCurl } from './logic';
import { STRINGS } from './strings';

const TARGETS: Target[] = ['fetch', 'node-fetch', 'python', 'php', 'go'];

const EXAMPLE = `curl -X POST 'https://api.example.com/users' \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer TOKEN' \\
  -d '{"name":"Alice","age":30}'`;

export function CurlConverterUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [curl, setCurl] = useState('');
  const [target, setTarget] = useState<Target>('fetch');
  const [result, setResult] = useState<{ ok: true; value: string } | { ok: false; error: string }>({
    ok: true,
    value: '',
  });

  useEffect(() => {
    if (!curl.trim()) {
      setResult({ ok: true, value: '' });
      return;
    }
    let cancelled = false;
    convertCurl(curl, target)
      .then((value) => {
        if (!cancelled) setResult({ ok: true, value });
      })
      .catch((e) => {
        if (!cancelled)
          setResult({ ok: false, error: e instanceof Error ? e.message : ui.conversionFailed });
      });
    return () => {
      cancelled = true;
    };
  }, [curl, target, ui.conversionFailed]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">{s.target}</span>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as Target)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {TARGETS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setCurl(EXAMPLE)}
            className="text-sm text-primary hover:underline"
          >
            {ui.tryExample}
          </button>
        </div>
        {/* Unlike the rest of the catalogue this tool cannot run client-side — parsing curl
            needs tree-sitter on the server. This sits above the input, not below it: a warning
            about what you are about to paste is useless after you have pasted it, and curl
            commands routinely carry tokens, cookies and API keys. */}
        <p className="text-xs text-muted-foreground border border-border rounded-md px-3 py-2">
          {s.serverNote}
        </p>
        <div>
          <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            {s.curlCommand}
          </span>
          <Textarea
            value={curl}
            onChange={(e) => setCurl(e.target.value)}
            placeholder={EXAMPLE}
            rows={6}
            className="font-mono"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{target}</span>
            {result.ok && result.value && <CopyButton text={result.value} />}
          </div>
          {result.ok ? (
            <pre className="rounded-md border bg-muted px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all min-h-[200px]">
              {result.value || <span className="text-muted-foreground italic">—</span>}
            </pre>
          ) : (
            <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {result.error}
            </output>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
