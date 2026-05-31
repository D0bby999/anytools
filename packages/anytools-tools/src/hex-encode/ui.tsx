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
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { decodeHex, encodeHex } from './logic';

export function HexEncodeUi() {
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const [input, setInput] = useState('');
  const [separator, setSeparator] = useState(' ');
  const [prefix, setPrefix] = useState('');
  const [uppercase, setUppercase] = useState(false);

  const output = useMemo(() => {
    try {
      if (mode === 'encode') {
        return { ok: true as const, value: encodeHex(input, { separator, prefix, uppercase }) };
      }
      return { ok: true as const, value: decodeHex(input) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Conversion failed' };
    }
  }, [input, mode, separator, prefix, uppercase]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Hex Encode / Decode</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'encode' | 'decode')}>
          <TabsList>
            <TabsTrigger value="encode">Text → Hex</TabsTrigger>
            <TabsTrigger value="decode">Hex → Text</TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === 'encode' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-sm">
              <span className="block mb-1 text-muted-foreground">Separator</span>
              <Input
                value={separator}
                onChange={(e) => setSeparator(e.target.value)}
                placeholder="(none)"
              />
            </label>
            <label className="text-sm">
              <span className="block mb-1 text-muted-foreground">Byte prefix</span>
              <Input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="(none)"
              />
            </label>
            <label className="flex items-center gap-2 text-sm pt-6">
              <input
                type="checkbox"
                checked={uppercase}
                onChange={(e) => setUppercase(e.target.checked)}
                className="h-4 w-4"
              />
              Uppercase
            </label>
          </div>
        )}

        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={5}
          className="font-mono text-sm"
          placeholder={
            mode === 'encode' ? 'Type text...' : 'Paste hex (spaces, 0x prefix, mixed case all OK)'
          }
        />

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Output</span>
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
