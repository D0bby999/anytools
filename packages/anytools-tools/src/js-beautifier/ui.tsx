'use client';
import {
  Button,
  CheckboxField,
  ConverterTemplate,
  CopyButton,
  Input,
  Label,
  PrivacyNote,
  SegmentedControl,
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
    <ConverterTemplate
      title={s.title}
      toolbar={
        <>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            ariaLabel={ui.beautify}
            className="w-auto min-w-56"
            options={[
              { value: 'beautify', label: ui.beautify },
              { value: 'minify', label: s.minifyTerser },
            ]}
          />
          {mode === 'beautify' && (
            <div className="space-y-1.5">
              <Label htmlFor={indentId}>{ui.indentSize}</Label>
              <Input
                id={indentId}
                type="number"
                min={1}
                max={8}
                value={indentSize}
                onChange={(e) => setIndentSize(Number(e.target.value))}
                className="w-24"
              />
            </div>
          )}
          {mode === 'minify' && (
            <CheckboxField
              label={s.mangleNames}
              checked={mangle}
              onCheckedChange={(v) => setMangle(v === true)}
            />
          )}
          <Button variant="outline" size="sm" onClick={() => setInput(EXAMPLE)}>
            {ui.tryExample}
          </Button>
        </>
      }
      source={
        <div className="space-y-1.5">
          <div className="flex min-h-8 items-center">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {ui.input}
            </span>
          </div>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={14}
            className="h-full font-mono text-sm"
            placeholder={EXAMPLE}
            aria-label={ui.input}
          />
        </div>
      }
      target={
        <div className="space-y-1.5">
          <div className="flex min-h-8 items-center justify-between">
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
              rows={14}
              className="h-full font-mono text-sm"
              aria-label={ui.output}
            />
          )}
          {output?.mode === 'minify' && output.before > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {s.sizeNote
                .replace('{before}', String(output.before))
                .replace('{after}', String(output.after))
                .replace('{pct}', ((1 - output.after / output.before) * 100).toFixed(1))}
            </p>
          )}
        </div>
      }
      disclaimer={<PrivacyNote />}
    />
  );
}
