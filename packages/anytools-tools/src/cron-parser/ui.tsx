'use client';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  PrivacyNote,
  useLocalized,
  useToolLocale,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import { parseCron, validateCron } from './logic';
import { STRINGS } from './strings';

type PresetKey = keyof typeof STRINGS.en & `preset${string}`;

const PRESETS: { key: PresetKey; expr: string }[] = [
  { key: 'presetEveryMinute', expr: '* * * * *' },
  { key: 'presetEvery5Minutes', expr: '*/5 * * * *' },
  { key: 'presetHourly', expr: '0 * * * *' },
  { key: 'presetDailyMidnight', expr: '0 0 * * *' },
  { key: 'presetDaily9am', expr: '0 9 * * *' },
  { key: 'presetWeeklySunMidnight', expr: '0 0 * * 0' },
  { key: 'presetMonthly1st', expr: '0 0 1 * *' },
  { key: 'presetBusinessHours', expr: '0 9-17 * * 1-5' },
];

/** Localized text for a coded message returned by the logic layer, falling back to its English. */
function localizedMessage(
  table: Record<string, string>,
  key: string,
  params: Record<string, string | number> | undefined,
  fallback: string,
): string {
  const template = table[key];
  if (!template) return fallback;
  return Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
    template,
  );
}

export function CronParserUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [expr, setExpr] = useState('0 0 * * *');
  const valid = useMemo(() => validateCron(expr), [expr]);
  const parsed = useMemo(
    () => (valid.valid ? parseCron(expr, 10, 'UTC', locale) : null),
    [expr, valid.valid, locale],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            {s.cronExpression}
          </span>
          <Input
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            placeholder="* * * * *"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">{s.fieldsHint}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button key={p.expr} variant="outline" size="sm" onClick={() => setExpr(p.expr)}>
              {s[p.key]}
            </Button>
          ))}
        </div>

        {!valid.valid ? (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {localizedMessage(s, `error_${valid.code}`, valid.params, valid.error ?? '')}
          </output>
        ) : parsed ? (
          <>
            <div className="rounded-md border bg-muted px-3 py-2 text-sm">
              <span className="text-muted-foreground">{s.description}</span>
              <strong>{parsed.description}</strong>
            </div>
            <div>
              <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                {s.next10Runs}
              </span>
              <ul className="space-y-1 text-sm font-mono">
                {parsed.nextRuns.map((d, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: ephemeral
                  <li key={`run-${i}`} className="rounded bg-muted px-3 py-1">
                    {d.toISOString()}
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : null}
        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
