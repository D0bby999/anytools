'use client';
import { CalculatorTemplate, Input, TableResult, useLocalized, useToolLocale } from '@anytools/ui';
import { useState } from 'react';
import { parseDateInput, todayInputValue } from '../shared/date-input';
import { calculatePregnancy } from './logic';
import { STRINGS } from './strings';

const today = () => todayInputValue();

export function PregnancyDueDateUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [lmp, setLmp] = useState(today());

  const lmpDate = parseDateInput(lmp) ?? new Date(Number.NaN);
  const result = calculatePregnancy(lmpDate);
  const due = result?.dueDate ?? null;
  const weeks = result?.weeks ?? 0;
  const days = result?.days ?? 0;
  const trimester = result?.trimester ?? 1;
  const remaining = result?.remainingDays ?? 0;

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <div>
          <span className="block text-sm font-medium mb-1.5">{s.lmpLabel}</span>
          <Input
            type="date"
            value={lmp}
            max={today()}
            onChange={(e) => setLmp(e.target.value)}
            className="h-11"
            aria-label={s.lmpAria}
          />
        </div>
      }
      result={
        due ? (
          <TableResult
            rows={[
              {
                label: s.row_dueDate,
                value: due.toLocaleDateString(locale, {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                }),
                emphasis: true,
              },
              {
                label: s.row_gestationalAge,
                value: s.gestationalValue
                  .replace('{w}', String(weeks))
                  .replace('{d}', String(days)),
                emphasis: true,
              },
              { label: s.row_trimester, value: s.trimesterValue.replace('{n}', String(trimester)) },
              {
                label: s.row_daysUntil,
                value: s.daysValue.replace('{n}', remaining.toLocaleString(locale)),
              },
            ]}
          />
        ) : (
          <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
            {s.pickDate}
          </div>
        )
      }
      onReset={() => setLmp(today())}
      disclaimer={s.disclaimer}
    />
  );
}
