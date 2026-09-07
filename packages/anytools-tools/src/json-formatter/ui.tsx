'use client';
import {
  Button,
  CheckboxField,
  ConverterTemplate,
  CopyButton,
  PrivacyNote,
  RadioGroup,
  RadioGroupField,
  Textarea,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useEffect, useMemo, useState } from 'react';
import {
  type ParseError,
  type ParseMode,
  formatJson,
  minifyJson,
  parseJson,
  sortJsonKeys,
} from './logic';
import { STRINGS } from './strings';

type IndentChoice = '2' | '4' | 'tab';

export function JsonFormatterUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [input, setInput] = useState('');
  const [indent, setIndent] = useState<IndentChoice>('2');
  const [sortKeys, setSortKeys] = useState(false);
  const [mode, setMode] = useState<ParseMode>('strict');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<ParseError | null>(null);
  const [unsafeIntegers, setUnsafeIntegers] = useState<string[]>([]);

  const indentValue = useMemo<number | string>(
    () => (indent === 'tab' ? '\t' : Number(indent)),
    [indent],
  );

  useEffect(() => {
    if (input.trim().length === 0) {
      setOutput('');
      setError(null);
      setUnsafeIntegers([]);
      return;
    }
    const parsed = parseJson(input, mode);
    if (!parsed.ok) {
      setOutput('');
      setError(parsed.error);
      setUnsafeIntegers([]);
      return;
    }
    const value = sortKeys ? sortJsonKeys(parsed.value) : parsed.value;
    setOutput(formatJson(value, indentValue));
    setError(null);
    setUnsafeIntegers(parsed.unsafeIntegers);
  }, [input, indentValue, sortKeys, mode]);

  const doMinify = () => {
    const parsed = parseJson(input, mode);
    if (parsed.ok) setOutput(minifyJson(sortKeys ? sortJsonKeys(parsed.value) : parsed.value));
  };

  return (
    <ConverterTemplate
      title={s.title}
      toolbar={
        <>
          {/* Moved above the panes from below them: these govern the conversion, and the layout
              contract puts options between the input and the result, not after it. */}
          <div className="space-y-1.5">
            <span className="block text-sm font-medium">{ui.indent}</span>
            <RadioGroup
              value={indent}
              onValueChange={(v) => setIndent(v as IndentChoice)}
              aria-label={ui.indent}
              className="flex gap-3"
            >
              {(['2', '4', 'tab'] as IndentChoice[]).map((opt) => (
                <RadioGroupField key={opt} value={opt} label={opt} />
              ))}
            </RadioGroup>
          </div>
          <CheckboxField
            label={s.sortKeysDeep}
            checked={sortKeys}
            onCheckedChange={(v) => setSortKeys(v === true)}
          />
          <CheckboxField
            label={s.json5Option}
            checked={mode === 'forgiving'}
            onCheckedChange={(v) => setMode(v === true ? 'forgiving' : 'strict')}
          />
          <Button variant="outline" size="sm" onClick={doMinify} disabled={!input}>
            {ui.minify}
          </Button>
        </>
      }
      source={
        <div className="space-y-1.5">
          <div className="flex min-h-8 items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {ui.input}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setInput('')}
              disabled={input.length === 0}
            >
              {ui.clear}
            </Button>
          </div>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={'{ "hello": "world", "items": [1, 2, 3] }'}
            rows={14}
            className="h-full"
            aria-label={s.jsonInput}
          />
        </div>
      }
      target={
        <div className="space-y-1.5">
          <div className="flex min-h-8 items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              {ui.output}
            </span>
            {output && <CopyButton text={output} />}
          </div>
          {error ? (
            <output className="block whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error.line
                ? s.lineCol
                    .replace('{line}', String(error.line))
                    .replace('{col}', String(error.col))
                : ''}
              {error.message}
              {error.json5Ok && <p className="mt-1 text-foreground">{s.json5Hint}</p>}
            </output>
          ) : (
            <pre className="min-h-[336px] whitespace-pre-wrap break-all rounded-md border bg-muted px-3 py-2 font-mono text-sm">
              {output || (
                <span className="italic text-muted-foreground">{s.outputPlaceholder}</span>
              )}
            </pre>
          )}
          {unsafeIntegers.length > 0 && (
            <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              {s.unsafeWarning.replace('{list}', unsafeIntegers.join(', '))}
            </p>
          )}
        </div>
      }
      disclaimer={<PrivacyNote />}
    />
  );
}
