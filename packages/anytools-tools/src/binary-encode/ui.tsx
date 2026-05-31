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
import { decodeBinary, encodeBinary } from './logic';

export function BinaryEncodeUi() {
  const [mode, setMode] = useState<'encode' | 'decode'>('encode');
  const [input, setInput] = useState('');
  const [separator, setSeparator] = useState(' ');

  const output = useMemo(() => {
    try {
      if (mode === 'encode') return { ok: true as const, value: encodeBinary(input, separator) };
      return { ok: true as const, value: decodeBinary(input) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Conversion failed' };
    }
  }, [input, mode, separator]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Binary Encode / Decode</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'encode' | 'decode')}>
          <TabsList>
            <TabsTrigger value="encode">Text → Binary</TabsTrigger>
            <TabsTrigger value="decode">Binary → Text</TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === 'encode' && (
          <label className="text-sm block">
            <span className="block mb-1 text-muted-foreground">Byte separator</span>
            <Input
              value={separator}
              onChange={(e) => setSeparator(e.target.value)}
              placeholder="(empty for no separator)"
            />
          </label>
        )}
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={5}
          className="font-mono text-sm"
          placeholder={mode === 'encode' ? 'Type text...' : 'Paste 8-bit binary (spaces optional)'}
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
