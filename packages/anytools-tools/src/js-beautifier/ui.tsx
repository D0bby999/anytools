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
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useEffect, useId, useState } from 'react';
import { beautifyJs, minifyJs } from './logic';
import { STRINGS } from './strings';

const EXAMPLE = `function fibonacci(n){if(n<2)return n;return fibonacci(n-1)+fibonacci(n-2);}\nconst result = [0,1,2,3,4,5].map(fibonacci);\nconsole.log(result);`;

type Output =
  | { mode: 'beautify'; code: string }
  | { mode: 'minify'; code: string; before: number; after: number }
  | { mode: 'error'; error: string };

export function JsBeautifierUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [input, setInput] = useState('');
  const [indentSize, setIndentSize] = useState(2);
  const [mode, setMode] = useState<'beautify' | 'minify'>('beautify');
  const [mangle, setMangle] = useState(true);
  const [output, setOutput] = useState<Output | null>(null);
  const indentId = useId();

  useEffect(() => {
    if (!input.trim()) {
      setOutput(null);
      return;
    }
    let cancelled = false;
    if (mode === 'beautify') {
      try {
        setOutput({ mode: 'beautify', code: beautifyJs(input, { indentSize }) });
      } catch (e) {
        setOutput({ mode: 'error', error: e instanceof Error ? e.message : ui.formatFailed });
      }
      return;
    }
    minifyJs(input, { mangle })
      .then((r) => {
        if (cancelled) return;
        setOutput({ mode: 'minify', code: r.code, before: r.sizeBefore, after: r.sizeAfter });
      })
      .catch((e) => {
        if (cancelled) return;
        setOutput({ mode: 'error', error: e instanceof Error ? e.message : ui.minifyFailed });
      });
    return () => {
      cancelled = true;
    };
  }, [input, indentSize, mode, mangle, ui.formatFailed, ui.minifyFailed]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex gap-1 rounded-md border p-0.5">
            <button
              type="button"
              onClick={() => setMode('beautify')}
              className={`px-3 py-1 text-sm rounded ${mode === 'beautify' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
            >
              {ui.beautify}
            </button>
            <button
              type="button"
              onClick={() => setMode('minify')}
              className={`px-3 py-1 text-sm rounded ${mode === 'minify' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
            >
              {s.minifyTerser}
            </button>
          </div>
          {mode === 'beautify' && (
            <label className="text-sm" htmlFor={indentId}>
              <span className="block mb-1 text-muted-foreground">{ui.indentSize}</span>
              <Input
                id={indentId}
                type="number"
                min={1}
                max={8}
                value={indentSize}
                onChange={(e) => setIndentSize(Number(e.target.value))}
                className="w-24"
              />
            </label>
          )}
          {mode === 'minify' && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={mangle}
                onChange={(e) => setMangle(e.target.checked)}
                className="h-4 w-4"
              />
              {s.mangleNames}
            </label>
          )}
          <Button variant="outline" size="sm" onClick={() => setInput(EXAMPLE)}>
            {ui.tryExample}
          </Button>
        </div>

        <div>
          <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            {ui.input}
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
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {ui.output}
            </span>
            {output && (output.mode === 'beautify' || output.mode === 'minify') && output.code && (
              <CopyButton text={output.code} />
            )}
          </div>
          {output?.mode === 'error' ? (
            <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {output.error}
            </output>
          ) : (
            <Textarea
              value={output?.mode === 'beautify' || output?.mode === 'minify' ? output.code : ''}
              readOnly
              rows={10}
              className="font-mono text-sm"
            />
          )}
          {output?.mode === 'minify' && output.before > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              {s.sizeNote
                .replace('{before}', String(output.before))
                .replace('{after}', String(output.after))
                .replace('{pct}', ((1 - output.after / output.before) * 100).toFixed(1))}
            </p>
          )}
        </div>

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
