'use client';
import { trackEvent } from '@anytools/analytics';
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
import { useEffect, useRef, useState } from 'react';
import { richText } from '../shared/rich-text';
import { toolErrorText } from '../shared/tool-error';
import { runJqInWorker } from './jq-worker-client';
import { JQ_EXAMPLES, MAX_JQ_INPUT_BYTES, validateJqInputSize } from './logic';
import { STRINGS } from './strings';

const DEBOUNCE_MS = 300;
const MAX_INPUT_LABEL = `${Math.round(MAX_JQ_INPUT_BYTES / (1024 * 1024))} MB`;

export function JqPlaygroundUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [jsonInput, setJsonInput] = useState('');
  const [filter, setFilter] = useState('');
  const [output, setOutput] = useState('');
  const [stderr, setStderr] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // Bumped on every debounced run; a slow run whose generation no longer matches when it
  // resolves is a stale result (superseded by a newer keystroke) and must not overwrite the
  // screen — otherwise a fast filter that finishes AFTER a slower, older one would flicker
  // back to the old answer.
  const generationRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => {
      const generation = ++generationRef.current;
      if (jsonInput.trim().length === 0 || filter.trim().length === 0) {
        setOutput('');
        setStderr('');
        setError(null);
        setRunning(false);
        return;
      }
      try {
        validateJqInputSize(jsonInput);
      } catch (e) {
        setOutput('');
        setStderr('');
        setError(toolErrorText(e, s, ui.invalidInput));
        setRunning(false);
        return;
      }
      setRunning(true);
      trackEvent('tool_run', { tool: 'jq-playground' });
      runJqInWorker(jsonInput, filter).then((result) => {
        if (generationRef.current !== generation) return;
        setRunning(false);
        if (result.ok) {
          setOutput(result.stdout);
          setStderr(result.stderr);
          setError(null);
        } else {
          setOutput('');
          setStderr('');
          setError(s[`error_${result.code}`]?.replace('{detail}', result.error) ?? result.error);
        }
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [jsonInput, filter, s, ui.invalidInput]);

  const tryExample = (id: string) => {
    const example = JQ_EXAMPLES.find((e) => e.id === id);
    if (!example) return;
    setJsonInput(example.input);
    setFilter(example.query);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Input forwardRef which biome can't detect statically */}
          <label className="block text-sm">
            <span className="block mb-1 text-muted-foreground">{s.filter}</span>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={s.filterPlaceholder}
              className="font-mono"
              aria-label={s.filter}
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{s.examples}</span>
            {JQ_EXAMPLES.map((example) => (
              <Button
                key={example.id}
                type="button"
                variant="outline"
                size="sm"
                className="font-mono"
                onClick={() => tryExample(example.id)}
              >
                {example.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {s.jsonInput}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setJsonInput('')}
                disabled={jsonInput.length === 0}
              >
                {ui.clear}
              </Button>
            </div>
            <Textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder={s.jsonPlaceholder}
              rows={14}
              aria-label={s.jsonInput}
              className="font-mono"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {ui.output}
              </span>
              {output && <CopyButton text={output} />}
            </div>
            {error ? (
              <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap font-mono min-h-[336px]">
                {error}
              </output>
            ) : (
              <pre className="rounded-md border bg-muted px-3 py-2 text-sm font-mono whitespace-pre-wrap break-all min-h-[336px]">
                {running
                  ? s.running
                  : output || <span className="text-muted-foreground italic">{s.emptyOutput}</span>}
              </pre>
            )}
            {stderr && !error && (
              <p className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning whitespace-pre-wrap font-mono">
                {s.stderrLabel} {stderr}
              </p>
            )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {richText(s.footnote, { n: MAX_INPUT_LABEL })}
        </p>
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
