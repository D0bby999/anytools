'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PrivacyNote,
  SegmentedControl,
  Textarea,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useEffect, useState } from 'react';
import { toolErrorText } from '../shared/tool-error';
import {
  type SchemaDraft,
  type ValidationResult,
  inferSchema,
  validateAgainstSchema,
} from './logic';
import { STRINGS } from './strings';

const DEFAULT_SCHEMA = JSON.stringify(
  { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
  null,
  2,
);
const DEFAULT_DATA = JSON.stringify({ id: 42 }, null, 2);

export function JsonSchemaValidatorUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [schemaText, setSchemaText] = useState(DEFAULT_SCHEMA);
  const [dataText, setDataText] = useState(DEFAULT_DATA);
  const [draft, setDraft] = useState<SchemaDraft>('draft-07');
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inferError, setInferError] = useState(false);

  useEffect(() => {
    if (schemaText.trim().length === 0 || dataText.trim().length === 0) {
      setResult(null);
      setError(null);
      return;
    }
    let cancelled = false;
    validateAgainstSchema(schemaText, dataText, draft)
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        setError(null);
        trackEvent('tool_run', { tool: 'json-schema-validator' });
      })
      .catch((e) => {
        if (cancelled) return;
        setResult(null);
        setError(toolErrorText(e, s, ui.invalidInput));
      });
    return () => {
      cancelled = true;
    };
  }, [schemaText, dataText, draft, s, ui.invalidInput]);

  const doInfer = () => {
    try {
      const sample = JSON.parse(dataText);
      setSchemaText(JSON.stringify(inferSchema(sample), null, 2));
      setInferError(false);
    } catch {
      setInferError(true);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <SegmentedControl
          value={draft}
          onChange={setDraft}
          label={s.draftLabel}
          options={[
            { value: 'draft-07', label: s.draft07 },
            { value: '2020-12', label: s.draft2020 },
          ]}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {s.schemaLabel}
              </span>
              <Button variant="ghost" size="sm" onClick={doInfer} disabled={!dataText.trim()}>
                {s.inferButton}
              </Button>
            </div>
            <Textarea
              value={schemaText}
              onChange={(e) => setSchemaText(e.target.value)}
              placeholder={s.schemaPlaceholder}
              rows={16}
              className="font-mono text-sm"
              aria-label={s.schemaLabel}
            />
            {inferError && <p className="mt-1 text-xs text-destructive">{s.inferFailed}</p>}
          </div>
          <div>
            <span className="block text-xs uppercase tracking-wide text-muted-foreground mb-1">
              {s.dataLabel}
            </span>
            <Textarea
              value={dataText}
              onChange={(e) => setDataText(e.target.value)}
              placeholder={s.dataPlaceholder}
              rows={16}
              className="font-mono text-sm"
              aria-label={s.dataLabel}
            />
          </div>
        </div>

        {error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive whitespace-pre-wrap">
            {error}
          </p>
        ) : result === null ? (
          <p className="text-sm text-muted-foreground italic">{s.waiting}</p>
        ) : result.valid ? (
          <p className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm font-medium text-success">
            {s.valid}
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-sm font-medium text-destructive">
              {(result.errors.length === 1 ? s.invalidCount : s.invalidCountPlural).replace(
                '{n}',
                String(result.errors.length),
              )}
            </p>
            <ul className="divide-y rounded-lg border overflow-hidden">
              {result.errors.map((issue, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: errors have no stable id and can repeat the same path
                <li key={i} className="p-3 text-sm space-y-1">
                  <code className="font-mono text-xs font-semibold">{issue.instancePath}</code>
                  <p className="text-muted-foreground">{issue.message}</p>
                  {Object.keys(issue.params).length > 0 && (
                    <p className="font-mono text-xs text-muted-foreground/80">
                      {s.paramsLabel}: {JSON.stringify(issue.params)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
