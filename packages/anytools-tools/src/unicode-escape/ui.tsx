'use client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  PrivacyNote,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { toolErrorText } from '../shared/tool-error';
import { type EscapeMode, escapeUnicode, unescapeUnicode } from './logic';
import { STRINGS } from './strings';

export function UnicodeEscapeUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [mode, setMode] = useState<'escape' | 'unescape'>('escape');
  const [input, setInput] = useState('');
  const [escapeMode, setEscapeMode] = useState<EscapeMode>('json');
  const [uppercase, setUppercase] = useState(false);

  const output = useMemo(() => {
    try {
      if (mode === 'escape')
        return { ok: true as const, value: escapeUnicode(input, { mode: escapeMode, uppercase }) };
      return { ok: true as const, value: unescapeUnicode(input) };
    } catch (e) {
      return { ok: false as const, error: toolErrorText(e, s, ui.conversionFailed) };
    }
  }, [input, mode, escapeMode, uppercase, s, ui.conversionFailed]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={mode} onValueChange={(v) => setMode(v as 'escape' | 'unescape')}>
          <TabsList>
            <TabsTrigger value="escape">{s.escapeTab}</TabsTrigger>
            <TabsTrigger value="unescape">{s.unescapeTab}</TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === 'escape' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block mb-1 text-muted-foreground">{s.mode}</span>
              <select
                value={escapeMode}
                onChange={(e) => setEscapeMode(e.target.value as EscapeMode)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="json">{s.modeJson}</option>
                <option value="es6">{s.modeEs6}</option>
                <option value="all">{s.modeAll}</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm pt-6">
              <input
                type="checkbox"
                checked={uppercase}
                onChange={(e) => setUppercase(e.target.checked)}
                className="h-4 w-4"
              />
              {s.uppercaseHex}
            </label>
          </div>
        )}
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={5}
          className="font-mono text-sm"
          placeholder={mode === 'escape' ? s.typeText : s.pasteEscapes}
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
