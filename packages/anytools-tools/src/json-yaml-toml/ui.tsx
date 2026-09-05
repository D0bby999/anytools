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
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { toolErrorText } from '../shared/tool-error';
import { type Format, convertFormat, detectFormat } from './logic';
import { STRINGS } from './strings';

const FORMATS: Format[] = ['json', 'yaml', 'toml'];

export function JsonYamlTomlUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [input, setInput] = useState('');
  const [from, setFrom] = useState<Format>('json');
  const [to, setTo] = useState<Format>('yaml');

  const result = useMemo(() => {
    if (!input.trim()) return { ok: true as const, value: '' };
    try {
      return { ok: true as const, value: convertFormat(input, from, to) };
    } catch (e) {
      return { ok: false as const, error: toolErrorText(e, s, ui.conversionFailed) };
    }
  }, [input, from, to, s, ui.conversionFailed]);

  const autoDetect = () => setFrom(detectFormat(input));
  const swap = () => {
    setFrom(to);
    setTo(from);
    if (result.ok && result.value) setInput(result.value);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">{ui.from}</span>
            <select
              value={from}
              onChange={(e) => setFrom(e.target.value as Format)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <Button variant="outline" onClick={swap}>
            {s.swap}
          </Button>
          <label className="text-sm">
            <span className="block mb-1 text-muted-foreground">{ui.to}</span>
            <select
              value={to}
              onChange={(e) => setTo(e.target.value as Format)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            >
              {FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f.toUpperCase()}
                </option>
              ))}
            </select>
          </label>
          <Button variant="ghost" onClick={autoDetect}>
            {s.autoDetect}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              {ui.input} ({from})
            </span>
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={s.pasteHere.replace('{fmt}', from.toUpperCase())}
              rows={12}
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {ui.output} ({to})
              </span>
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
