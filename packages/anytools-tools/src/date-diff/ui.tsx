'use client';
import { CalculatorTemplate, Input, TableResult, useLocalized, useToolLocale } from '@anytools/ui';
import { useState } from 'react';
import { parseDateInput, todayInputValue } from '../shared/date-input';
import { dateDiff } from './logic';
import { STRINGS } from './strings';

const today = () => todayInputValue();

export function DateDiffUi() {
  const t = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [start, setStart] = useState('2020-01-01');
  const [end, setEnd] = useState(today());

  const s = parseDateInput(start) ?? new Date(Number.NaN);
  const e = parseDateInput(end) ?? new Date(Number.NaN);
  const valid = !Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime());
  const d = valid ? dateDiff(s, e) : null;
  const fmt = (n: number) => n.toLocaleString(locale);

  return (
    <CalculatorTemplate
      title={t.title}
      description={t.description}
      inputs={
        <>
          <div>
            <span className="block text-sm font-medium mb-1.5">{t.startDate}</span>
            <Input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="h-11"
              aria-label={t.startDate}
            />
          </div>
          <div>
            <span className="block text-sm font-medium mb-1.5">{t.endDate}</span>
            <Input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="h-11"
              aria-label={t.endDate}
            />
          </div>
        </>
      }
      result={
        d ? (
          <TableResult
            rows={[
              {
                label: t.duration,
                value: t.durationValue
                  .replace('{y}', String(d.years))
                  .replace('{m}', String(d.months))
                  .replace('{d}', String(d.days)),
                emphasis: true,
              },
              { label: t.totalWeeks, value: fmt(d.totalWeeks) },
              { label: t.totalDays, value: fmt(d.totalDays) },
              { label: t.totalHours, value: fmt(d.totalHours) },
            ]}
          />
        ) : (
          <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
            {t.pickValidDates}
          </div>
        )
      }
      onReset={() => {
        setStart('2020-01-01');
        setEnd(today());
      }}
    />
  );
}
