'use client';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, PrivacyNote } from '@anytools/ui';
import { useMemo, useState } from 'react';
import { parseCron, validateCron } from './logic';

const PRESETS: { label: string; expr: string }[] = [
  { label: 'Every minute', expr: '* * * * *' },
  { label: 'Every 5 minutes', expr: '*/5 * * * *' },
  { label: 'Hourly', expr: '0 * * * *' },
  { label: 'Daily midnight', expr: '0 0 * * *' },
  { label: 'Daily 9am', expr: '0 9 * * *' },
  { label: 'Weekly Sun midnight', expr: '0 0 * * 0' },
  { label: 'Monthly 1st', expr: '0 0 1 * *' },
  { label: 'Business hours', expr: '0 9-17 * * 1-5' },
];

export function CronParserUi() {
  const [expr, setExpr] = useState('0 0 * * *');
  const valid = useMemo(() => validateCron(expr), [expr]);
  const parsed = useMemo(() => (valid.valid ? parseCron(expr, 10) : null), [expr, valid.valid]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Cron Parser</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            Cron expression
          </span>
          <Input
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            placeholder="* * * * *"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">
            5 fields: minute hour day month weekday
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <Button key={p.expr} variant="outline" size="sm" onClick={() => setExpr(p.expr)}>
              {p.label}
            </Button>
          ))}
        </div>

        {!valid.valid ? (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {valid.error}
          </output>
        ) : parsed ? (
          <>
            <div className="rounded-md border bg-muted px-3 py-2 text-sm">
              <span className="text-muted-foreground">Description: </span>
              <strong>{parsed.description}</strong>
            </div>
            <div>
              <span className="block mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                Next 10 runs (UTC)
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
