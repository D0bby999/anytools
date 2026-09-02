'use client';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote, Textarea } from '@anytools/ui';
import { useEffect, useMemo, useState } from 'react';
import { parseUserAgent } from './logic';

export function UserAgentParserUi() {
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
      return { result: null, error: e instanceof Error ? e.message : 'Invalid' };
    }
  }, [input]);

  const r = state.result;
  const rows = r
    ? (
        [
          [
            'Browser',
            r.browser.version ? `${r.browser.name} ${r.browser.version}` : r.browser.name,
          ],
          ['Engine', r.engine.version ? `${r.engine.name} ${r.engine.version}` : r.engine.name],
          ['Operating system', r.os.version ? `${r.os.name} ${r.os.version}` : r.os.name],
          ['Device type', r.device.type],
          ['Device model', r.device.model],
        ] as const
      ).filter(([, v]) => v)
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">User Agent Parser</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">
            User-Agent string — yours is filled in below
          </span>
          <Textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3} />
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

        <p className="text-sm text-muted-foreground">
          User-Agent strings are historical fiction — every browser claims to be Mozilla, Chrome
          claims to be Safari, Edge claims to be Chrome. Anyone can send any string. Useful as a
          hint for support and analytics; never as a security control.
        </p>

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
