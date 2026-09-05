'use client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Input,
  PrivacyNote,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useId, useMemo, useState } from 'react';
import { decodeBinary, encodeBinary } from './logic';
import { STRINGS } from './strings';

export function BinaryEncodeUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const [input, setInput] = useState('');
  const [separator, setSeparator] = useState(' ');
  const separatorId = useId();

  const output = useMemo(() => {
    try {
      if (mode === 'encode') return { ok: true as const, value: encodeBinary(input, separator) };
      return { ok: true as const, value: decodeBinary(input) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : ui.conversionFailed };
    }
  }, [input, mode, separator, ui.conversionFailed]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'encode' | 'decode')}>
          <TabsList>
            <TabsTrigger value="encode">{s.toBinary}</TabsTrigger>
            <TabsTrigger value="decode">{s.fromBinary}</TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === 'encode' && (
          <label className="text-sm block" htmlFor={separatorId}>
            <span className="block mb-1 text-muted-foreground">{s.byteSeparator}</span>
            <Input
              id={separatorId}
              value={separator}
              onChange={(e) => setSeparator(e.target.value)}
              placeholder={s.separatorPlaceholder}
            />
          </label>
        )}
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={5}
          className="font-mono text-sm"
          placeholder={mode === 'encode' ? ui.typeText : s.pasteBinary}
        />
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {ui.output}
            </span>
            {output.ok && output.value && <CopyButton text={output.value} />}
          </div>
          {output.ok ? (
            <Textarea value={output.value} readOnly rows={5} className="font-mono text-sm" />
          ) : (
            <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {output.error}
            </output>
          )}
        </div>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
