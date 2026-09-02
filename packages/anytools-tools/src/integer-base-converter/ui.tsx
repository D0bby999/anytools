'use client';
import { Card, CardContent, CardHeader, CardTitle, CopyButton, PrivacyNote } from '@anytools/ui';
import { useMemo, useState } from 'react';
import { MAX_BASE, MIN_BASE, convertToCommonBases, formatInBase, parseInBase } from './logic';

export function IntegerBaseConverterUi() {
  const [value, setValue] = useState('255');
  const [fromBase, setFromBase] = useState(10);
  const [customBase, setCustomBase] = useState(36);

  const state = useMemo(() => {
    try {
      const parsed = parseInBase(value, fromBase);
      return {
        rows: convertToCommonBases(value, fromBase),
        custom: formatInBase(parsed, customBase),
        error: null as string | null,
      };
    } catch (e) {
      return { rows: [], custom: '', error: e instanceof Error ? e.message : 'Invalid input' };
    }
  }, [value, fromBase, customBase]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Integer Base Converter</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Number</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="255, 0xFF, 1_000"
              className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Input base</span>
            <input
              type="number"
              min={MIN_BASE}
              max={MAX_BASE}
              value={fromBase}
              onChange={(e) => setFromBase(Number(e.target.value))}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-28"
            />
          </label>
        </div>

        {state.error ? (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.error}
          </output>
        ) : (
          <div className="space-y-2">
            {state.rows.map((r) => (
              <div
                key={r.base}
                className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2"
              >
                <span className="w-20 shrink-0 text-sm text-muted-foreground">{r.label}</span>
                <code className="min-w-0 flex-1 truncate font-mono text-sm">{r.value}</code>
                <CopyButton text={r.value} />
              </div>
            ))}
            <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
              <label className="flex w-20 shrink-0 items-center gap-1 text-sm text-muted-foreground">
                Base
                <input
                  type="number"
                  min={MIN_BASE}
                  max={MAX_BASE}
                  value={customBase}
                  onChange={(e) => setCustomBase(Number(e.target.value))}
                  className="h-7 w-12 rounded border border-input bg-background px-1 text-sm"
                />
              </label>
              <code className="min-w-0 flex-1 truncate font-mono text-sm">{state.custom}</code>
              <CopyButton text={state.custom} />
            </div>
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          Values are parsed as arbitrary-precision integers, so numbers above 2^53 stay exact —
          <code>parseInt</code> would round them.
        </p>

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
