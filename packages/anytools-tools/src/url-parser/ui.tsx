'use client';
import { Card, CardContent, CardHeader, CardTitle, CopyButton, PrivacyNote } from '@anytools/ui';
import { useMemo, useState } from 'react';
import { parseUrl } from './logic';

export function UrlParserUi() {
  const [input, setInput] = useState(
    'https://example.com:8443/docs/getting-started?tag=a&tag=b#intro',
  );

  const state = useMemo(() => {
    try {
      return { url: parseUrl(input), error: null as string | null };
    } catch (e) {
      return { url: null, error: e instanceof Error ? e.message : 'Invalid URL' };
    }
  }, [input]);

  const rows = state.url
    ? (
        [
          ['Protocol', state.url.protocol],
          ['Username', state.url.username],
          ['Password', state.url.password ? '••••••••' : ''],
          ['Hostname', state.url.hostname],
          ['Port', state.url.port || `${state.url.effectivePort} (default)`],
          ['Origin', state.url.origin],
          ['Path', state.url.pathname],
          ['Fragment', state.url.hash],
        ] as const
      ).filter(([, v]) => v)
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">URL Parser</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">URL</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm"
          />
        </label>

        {state.error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.error}
          </output>
        )}

        {state.url && (
          <>
            <div className="space-y-2">
              {rows.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2"
                >
                  <span className="w-24 shrink-0 text-sm text-muted-foreground">{label}</span>
                  <code className="min-w-0 flex-1 truncate font-mono text-sm">{value}</code>
                  <CopyButton text={value} />
                </div>
              ))}
            </div>

            {state.url.segments.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm text-muted-foreground">Path segments</h3>
                <ol className="space-y-1">
                  {state.url.segments.map((s, i) => (
                    <li
                      key={`${i}-${s}`}
                      className="rounded-md border bg-muted/40 px-3 py-1.5 font-mono text-sm"
                    >
                      {i + 1}. {s}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div>
              <h3 className="mb-2 text-sm text-muted-foreground">
                Query parameters ({state.url.params.length})
              </h3>
              {state.url.params.length === 0 ? (
                <p className="text-sm text-muted-foreground">None.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="pb-1 font-normal">Key</th>
                      <th className="pb-1 font-normal">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Index in the key: repeated keys are legal (?tag=a&tag=b) and are kept
                        rather than collapsed, so the key alone is not unique. */}
                    {state.url.params.map((p, i) => (
                      <tr key={`${p.key}-${i}`} className="border-t">
                        <td className="py-1.5 pr-3 font-mono">{p.key}</td>
                        <td className="py-1.5 font-mono break-all">
                          {p.value || <em>(empty)</em>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
