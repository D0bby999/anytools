'use client';
import { CalculatorTemplate, Input, TableResult } from '@anytools/ui';
import { useState } from 'react';
import { parseDateInput, todayInputValue } from '../shared/date-input';
import { calculatePregnancy, fmtDate } from './logic';

const today = () => todayInputValue();

export function PregnancyDueDateUi() {
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
      title="Pregnancy Due Date Calculator"
      description="Naegele's rule — last menstrual period + 280 days."
      inputs={
        <div>
          <span className="block text-sm font-medium mb-1.5">
            First day of last menstrual period
          </span>
          <Input
            type="date"
            value={lmp}
            max={today()}
            onChange={(e) => setLmp(e.target.value)}
            className="h-11"
            aria-label="LMP date"
          />
        </div>
      }
      result={
        due ? (
          <TableResult
            rows={[
              { label: 'Estimated due date', value: fmtDate(due), emphasis: true },
              { label: 'Gestational age', value: `${weeks}w ${days}d`, emphasis: true },
              { label: 'Trimester', value: `Trimester ${trimester}` },
              { label: 'Days until due', value: `${remaining.toLocaleString()} days` },
            ]}
          />
        ) : (
          <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
            Pick LMP date.
          </div>
        )
      }
      onReset={() => setLmp(today())}
      disclaimer="For information only. Naegele's rule assumes a 28-day cycle and ovulation on day 14. Ultrasound dating is more accurate. Consult your obstetrician for medical care."
    />
  );
}
