'use client';
import {
  Button,
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
import { useId, useMemo, useState } from 'react';
import { beautifyCss, minifyCss } from './logic';
import { STRINGS } from './strings';

const EXAMPLE = `.btn,.cta{display:inline-flex;align-items:center;padding:8px 16px;color:#fff;background:#2563eb;border-radius:6px}.btn:hover,.cta:hover{opacity:.9}`;

export function CssBeautifierUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [input, setInput] = useState('');
  const [indentSize, setIndentSize] = useState(2);
  const [mode, setMode] = useState<'beautify' | 'minify'>('beautify');
  const indentId = useId();

  const output = useMemo(() => {
    try {
      if (mode === 'minify') return { ok: true as const, value: minifyCss(input) };
      return { ok: true as const, value: beautifyCss(input, { indentSize }) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : ui.formatFailed };
    }
  }, [input, indentSize, mode, ui.formatFailed]);

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
              { value: 'minify', label: ui.minify },
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
          <Button variant="outline" size="sm" onClick={() => setInput(EXAMPLE)}>
            {ui.tryExample}
          </Button>
        </>
      }
      source={
        <div className="space-y-1.5">
          {/* Same min-h-8 header row as the output pane. Without it the two column labels sit
              at different heights, because only the output side carries a CopyButton. */}
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
            {output.ok && output.value && <CopyButton text={output.value} />}
          </div>
          {output.ok ? (
            <Textarea
              value={output.value}
              readOnly
              rows={14}
              className="h-full font-mono text-sm"
              aria-label={ui.output}
            />
          ) : (
            <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {output.error}
            </output>
          )}
        </div>
      }
      disclaimer={<PrivacyNote />}
    />
  );
}
