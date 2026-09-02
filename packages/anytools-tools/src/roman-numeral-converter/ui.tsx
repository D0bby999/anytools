'use client';
import { Card, CardContent, CardHeader, CardTitle, CopyButton, PrivacyNote } from '@anytools/ui';
import { useMemo, useState } from 'react';
import { MAX_ROMAN, fromRoman, toRoman } from './logic';

export function RomanNumeralConverterUi() {
  const [numberInput, setNumberInput] = useState('2026');
  const [romanInput, setRomanInput] = useState('MMXXVI');

  const toRomanResult = useMemo(() => {
    try {
      return { value: toRoman(Number(numberInput)), error: null as string | null };
    } catch (e) {
      return { value: '', error: e instanceof Error ? e.message : 'Invalid' };
    }
  }, [numberInput]);

  const fromRomanResult = useMemo(() => {
    try {
      return { value: String(fromRoman(romanInput)), error: null as string | null };
    } catch (e) {
      return { value: '', error: e instanceof Error ? e.message : 'Invalid' };
    }
  }, [romanInput]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Roman Numeral Converter</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Number → Roman (1–{MAX_ROMAN})</span>
            <input
              type="number"
              value={numberInput}
              onChange={(e) => setNumberInput(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
          {toRomanResult.error ? (
            <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {toRomanResult.error}
            </output>
          ) : (
            <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
              <code className="min-w-0 flex-1 truncate font-mono text-lg tracking-wide">
                {toRomanResult.value}
              </code>
              <CopyButton text={toRomanResult.value} />
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Roman → Number</span>
            <input
              value={romanInput}
              onChange={(e) => setRomanInput(e.target.value)}
              placeholder="MCMXCIV"
              className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm uppercase"
            />
          </label>
          {fromRomanResult.error ? (
            <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {fromRomanResult.error}
            </output>
          ) : (
            <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
              <code className="min-w-0 flex-1 truncate font-mono text-lg">
                {fromRomanResult.value}
              </code>
              <CopyButton text={fromRomanResult.value} />
            </div>
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          Only standard notation is accepted. IIII and IM are readable and both are invalid — the
          converter says so and suggests the correct form.
        </p>

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
