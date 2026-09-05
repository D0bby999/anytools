'use client';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CopyButton,
  Input,
  PrivacyNote,
  useLocalized,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { type CronFields, EVERY, PRESETS, describeExpression } from './logic';
import { STRINGS } from './strings';

const FIELD_KEYS: (keyof CronFields)[] = ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'];

export function CrontabGeneratorUi() {
  const s = useLocalized(STRINGS);
  const fieldDefs: Record<keyof CronFields, { label: string; hint: string }> = {
    minute: { label: s.minute, hint: '0–59, *, */5, 0,30' },
    hour: { label: s.hour, hint: '0–23, *, 9-17' },
    dayOfMonth: { label: s.dayOfMonth, hint: '1–31, *' },
    month: { label: s.month, hint: '1–12, *' },
    dayOfWeek: { label: s.dayOfWeek, hint: s.dayOfWeekHint },
  };
  // Preset labels come from logic.ts in English; map them to the locale by id.
  const presetLabel: Record<string, string> = {
    'every-minute': s.preset_every_minute,
    'every-5-min': s.preset_every_5_min,
    'every-15-min': s.preset_every_15_min,
    hourly: s.preset_hourly,
    'daily-midnight': s.preset_daily_midnight,
    'daily-9am': s.preset_daily_9am,
    'weekdays-9am': s.preset_weekdays_9am,
    'weekly-sunday': s.preset_weekly_sunday,
    'monthly-first': s.preset_monthly_first,
    'yearly-jan1': s.preset_yearly_jan1,
  };
  const [fields, setFields] = useState<CronFields>({ ...EVERY, minute: '0', hour: '9' });
  const result = useMemo(() => describeExpression(fields), [fields]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
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
              {presetLabel[preset.id] ?? preset.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {FIELD_KEYS.map((key) => {
            const { label, hint } = fieldDefs[key];
            return (
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
            );
          })}
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
                {s.next5Runs}
              </p>
              <ul className="space-y-1 font-mono text-sm">
                {result.nextRuns.map((run) => (
                  <li key={run.toISOString()}>
                    {run.toISOString().replace('T', ' ').slice(0, 16)}
                  </li>
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
