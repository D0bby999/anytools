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
import { toolErrorText } from '../shared/tool-error';
import { decodeHex, encodeHex } from './logic';
import { STRINGS } from './strings';

export function HexEncodeUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const [input, setInput] = useState('');
  const [separator, setSeparator] = useState(' ');
  const [prefix, setPrefix] = useState('');
  const [uppercase, setUppercase] = useState(false);
  const separatorId = useId();
  const prefixId = useId();

  const output = useMemo(() => {
    try {
      if (mode === 'encode') {
        return { ok: true as const, value: encodeHex(input, { separator, prefix, uppercase }) };
      }
      return { ok: true as const, value: decodeHex(input) };
    } catch (e) {
      return { ok: false as const, error: toolErrorText(e, s, ui.conversionFailed) };
    }
  }, [input, mode, separator, prefix, uppercase, s, ui.conversionFailed]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'encode' | 'decode')}>
          <TabsList>
            <TabsTrigger value="encode">{s.toHex}</TabsTrigger>
            <TabsTrigger value="decode">{s.fromHex}</TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === 'encode' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-sm" htmlFor={separatorId}>
              <span className="block mb-1 text-muted-foreground">{s.separator}</span>
              <Input
                id={separatorId}
                value={separator}
                onChange={(e) => setSeparator(e.target.value)}
                placeholder={ui.none}
              />
            </label>
            <label className="text-sm" htmlFor={prefixId}>
              <span className="block mb-1 text-muted-foreground">{s.bytePrefix}</span>
              <Input
                id={prefixId}
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder={ui.none}
              />
            </label>
            <label className="flex items-center gap-2 text-sm pt-6">
              <input
                type="checkbox"
                checked={uppercase}
                onChange={(e) => setUppercase(e.target.checked)}
                className="h-4 w-4"
              />
              {ui.uppercase}
            </label>
          </div>
        )}

        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={5}
          className="font-mono text-sm"
          placeholder={mode === 'encode' ? ui.typeText : s.pasteHex}
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
