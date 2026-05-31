'use client';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Input,
  PrivacyNote,
  Textarea,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { beautifyCss, minifyCss } from './logic';

const EXAMPLE = `.btn,.cta{display:inline-flex;align-items:center;padding:8px 16px;color:#fff;background:#2563eb;border-radius:6px}.btn:hover,.cta:hover{opacity:.9}`;

export function CssBeautifierUi() {
  const [input, setInput] = useState('');
  const [indentSize, setIndentSize] = useState(2);
  const [mode, setMode] = useState<'beautify' | 'minify'>('beautify');

  const output = useMemo(() => {
    try {
      if (mode === 'minify') return { ok: true as const, value: minifyCss(input) };
      return { ok: true as const, value: beautifyCss(input, { indentSize }) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Format failed' };
    }
  }, [input, indentSize, mode]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">CSS Beautifier / Minifier</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex gap-1 rounded-md border p-0.5">
            <button
              type="button"
              onClick={() => setMode('beautify')}
              className={`px-3 py-1 text-sm rounded ${mode === 'beautify' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
            >
              Beautify
            </button>
            <button
              type="button"
              onClick={() => setMode('minify')}
              className={`px-3 py-1 text-sm rounded ${mode === 'minify' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
            >
              Minify
            </button>
          </div>
          {mode === 'beautify' && (
            <label className="text-sm">
              <span className="block mb-1 text-muted-foreground">Indent size</span>
              <Input
                type="number"
                min={1}
                max={8}
                value={indentSize}
                onChange={(e) => setIndentSize(Number(e.target.value))}
                className="w-24"
              />
            </label>
          )}
          <Button variant="outline" size="sm" onClick={() => setInput(EXAMPLE)}>
            Try example
          </Button>
        </div>
        <div>
          <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            Input
          </span>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={8}
            className="font-mono text-sm"
            placeholder={EXAMPLE}
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Output</span>
            {output.ok && output.value && <CopyButton text={output.value} />}
          </div>
          {output.ok ? (
            <Textarea value={output.value} readOnly rows={10} className="font-mono text-sm" />
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
