'use client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PrivacyNote,
  Textarea,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useEffect, useId, useMemo, useState } from 'react';
import { parseUserAgent } from './logic';
import { STRINGS } from './strings';

export function UserAgentParserUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const inputId = useId();
  const [input, setInput] = useState('');

  // Prefill with the visitor's own UA — it is the string they most likely want to look at,
  // and it makes the tool useful before they type anything.
  useEffect(() => {
    if (typeof navigator !== 'undefined') setInput(navigator.userAgent);
  }, []);

  const state = useMemo(() => {
    try {
      return { result: parseUserAgent(input), error: null as string | null };
    } catch (e) {
      return { result: null, error: e instanceof Error ? e.message : ui.invalidInput };
    }
  }, [input, ui.invalidInput]);

  const r = state.result;
  // The logic layer names device types in English; map them to the locale here.
  const rows = r
    ? (
        [
          [
            s.browser,
            r.browser.version ? `${r.browser.name} ${r.browser.version}` : r.browser.name,
          ],
          [s.engine, r.engine.version ? `${r.engine.name} ${r.engine.version}` : r.engine.name],
          [s.os, r.os.version ? `${r.os.name} ${r.os.version}` : r.os.name],
          [s.deviceType, s[r.device.type] ?? r.device.type],
          [s.deviceModel, r.device.model],
        ] as const
      ).filter(([, v]) => v)
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label htmlFor={inputId} className="block text-sm">
          <span className="mb-1 block text-muted-foreground">{s.uaLabel}</span>
          <Textarea
            id={inputId}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
          />
        </label>

        {state.error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.error}
          </output>
        )}

        {r && (
          <div className="space-y-2">
            {rows.map(([label, value]) => (
              <div
                key={label}
                className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2"
              >
                <span className="w-36 shrink-0 text-sm text-muted-foreground">{label}</span>
                <span className="min-w-0 flex-1 truncate text-sm capitalize">{value}</span>
              </div>
            ))}
          </div>
        )}

        <p className="text-sm text-muted-foreground">{s.note}</p>

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
