'use client';
import { CalculatorTemplate, Input, TableResult, useLocalized, useToolLocale } from '@anytools/ui';
import { useState } from 'react';
import { parseDateInput, todayInputValue } from '../shared/date-input';
import { useClientNow } from '../shared/use-client-now';
import { calcAge } from './logic';
import { STRINGS } from './strings';

const DEFAULT = '1990-01-01';

export function AgeCalculatorUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [birth, setBirth] = useState(DEFAULT);
  const parsed = parseDateInput(birth) ?? new Date(Number.NaN);
  // Null until mounted, so the prerendered HTML carries no clock-dependent text.
  const now = useClientNow();
  const valid = now !== null && !Number.isNaN(parsed.getTime()) && parsed <= now;
  const age = valid && now ? calcAge(parsed, now) : null;
  const fmt = (n: number) => n.toLocaleString(locale);

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <div>
          <span className="block text-sm font-medium mb-1.5">{s.birthDate}</span>
          <Input
            type="date"
            value={birth}
            max={now ? todayInputValue(now) : undefined}
            onChange={(e) => setBirth(e.target.value)}
            aria-label={s.birthDate}
            className="h-11"
          />
        </div>
      }
      result={
        age ? (
          <TableResult
            rows={[
              {
                label: s.age,
                value: s.ageValue
                  .replace('{y}', String(age.years))
                  .replace('{m}', String(age.months))
                  .replace('{d}', String(age.days)),
                emphasis: true,
              },
              { label: s.totalDays, value: fmt(age.totalDays) },
              { label: s.totalHours, value: fmt(age.totalHours) },
              { label: s.totalMinutes, value: fmt(age.totalMinutes) },
            ]}
          />
        ) : (
          <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
            {s.pickPastDate}
          </div>
        )
      }
      onReset={() => setBirth(DEFAULT)}
    />
  );
}
