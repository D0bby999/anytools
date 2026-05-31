'use client';
import { CalculatorTemplate, Input, TableResult } from '@anytools/ui';
import { useState } from 'react';
import { dateDiff } from './logic';

const today = () => new Date().toISOString().slice(0, 10);

export function DateDiffUi() {
  const [start, setStart] = useState('2020-01-01');
  const [end, setEnd] = useState(today());

  const s = new Date(start);
  const e = new Date(end);
  const valid = !Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime());
  const d = valid ? dateDiff(s, e) : null;
  const fmt = (n: number) => n.toLocaleString();

  return (
    <CalculatorTemplate
      title="Date Difference"
      description="Years, months, days between two dates."
      inputs={
        <>
          <div>
            <span className="block text-sm font-medium mb-1.5">Start date</span>
            <Input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="h-11"
              aria-label="Start date"
            />
          </div>
          <div>
            <span className="block text-sm font-medium mb-1.5">End date</span>
            <Input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="h-11"
              aria-label="End date"
            />
          </div>
        </>
      }
      result={
        d ? (
          <TableResult
            rows={[
              {
                label: 'Duration',
                value: `${d.years}y ${d.months}m ${d.days}d`,
                emphasis: true,
              },
              { label: 'Total weeks', value: fmt(d.totalWeeks) },
              { label: 'Total days', value: fmt(d.totalDays) },
              { label: 'Total hours', value: fmt(d.totalHours) },
            ]}
          />
        ) : (
          <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
            Pick valid start + end dates.
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
