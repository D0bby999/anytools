'use client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  PrivacyNote,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { MAX_BASE, MIN_BASE, convertToCommonBases, formatInBase, parseInBase } from './logic';
import { STRINGS } from './strings';

export function IntegerBaseConverterUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [value, setValue] = useState('255');
  const [fromBase, setFromBase] = useState(10);
  const [customBase, setCustomBase] = useState(36);

  // The logic layer labels rows in English; map the four common bases to the locale.
  const baseLabel: Record<number, string> = {
    2: s.binary,
    8: s.octal,
    10: s.decimal,
    16: s.hex,
  };
  const [noteBefore, noteAfter] = s.precisionNote.split('{code}');

  const state = useMemo(() => {
    try {
      const parsed = parseInBase(value, fromBase);
      return {
        rows: convertToCommonBases(value, fromBase),
        custom: formatInBase(parsed, customBase),
        error: null as string | null,
      };
    } catch (e) {
      return { rows: [], custom: '', error: e instanceof Error ? e.message : ui.invalidInput };
    }
  }, [value, fromBase, customBase, ui.invalidInput]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">{s.number}</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="255, 0xFF, 1_000"
              className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">{s.inputBase}</span>
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
                <span className="w-20 shrink-0 text-sm text-muted-foreground">
                  {baseLabel[r.base] ?? r.label}
                </span>
                <code className="min-w-0 flex-1 truncate font-mono text-sm">{r.value}</code>
                <CopyButton text={r.value} />
              </div>
            ))}
            <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
              <label className="flex w-20 shrink-0 items-center gap-1 text-sm text-muted-foreground">
                {s.base}
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
          {noteBefore}
          <code>parseInt</code>
          {noteAfter}
        </p>

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
