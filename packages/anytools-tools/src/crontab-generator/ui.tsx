'use client';
import { Card, CardContent, CardHeader, CardTitle, CopyButton, Input, PrivacyNote } from '@anytools/ui';
import { useMemo, useState } from 'react';
import { type CronFields, EVERY, PRESETS, describeExpression } from './logic';

const FIELD_DEFS: { key: keyof CronFields; label: string; hint: string }[] = [
  { key: 'minute', label: 'Minute', hint: '0–59, *, */5, 0,30' },
  { key: 'hour', label: 'Hour', hint: '0–23, *, 9-17' },
  { key: 'dayOfMonth', label: 'Day of month', hint: '1–31, *' },
  { key: 'month', label: 'Month', hint: '1–12, *' },
  { key: 'dayOfWeek', label: 'Day of week', hint: '0–6 (Sun=0), 1-5' },
];

export function CrontabGeneratorUi() {
  const [fields, setFields] = useState<CronFields>({ ...EVERY, minute: '0', hour: '9' });
  const result = useMemo(() => describeExpression(fields), [fields]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Crontab Generator</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => setFields({ ...preset.fields })}
              className="rounded-full border px-3 py-1 text-xs hover:bg-accent/10 transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {FIELD_DEFS.map(({ key, label, hint }) => (
            <div key={key}>
              <span className="block text-sm font-medium mb-1.5">{label}</span>
              <Input
                value={fields[key]}
                onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
                aria-label={label}
                className="h-11 font-mono text-center"
              />
              <span className="block text-[10px] text-muted-foreground mt-1">{hint}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <code className="text-2xl font-mono font-semibold">{result.expression}</code>
          <CopyButton text={result.expression} />
        </div>

        {result.valid ? (
          <>
            <p className="text-sm">{result.description}</p>
            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                Next 5 runs (UTC)
              </p>
              <ul className="space-y-1 font-mono text-sm">
                {result.nextRuns.map((run) => (
                  <li key={run.toISOString()}>{run.toISOString().replace('T', ' ').slice(0, 16)}</li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <p className="text-sm text-destructive">{result.error}</p>
        )}
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
