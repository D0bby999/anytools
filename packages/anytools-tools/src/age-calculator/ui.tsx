'use client';
import { CalculatorTemplate, Input, TableResult } from '@anytools/ui';
import { useState } from 'react';
import { calcAge } from './logic';

const DEFAULT = '1990-01-01';

export function AgeCalculatorUi() {
  const [birth, setBirth] = useState(DEFAULT);
  const parsed = new Date(birth);
  const now = new Date();
  const valid = !Number.isNaN(parsed.getTime()) && parsed <= now;
  const age = valid ? calcAge(parsed, now) : null;
  const fmt = (n: number) => n.toLocaleString();

  return (
    <CalculatorTemplate
      title="Age Calculator"
      description="Exact age from birth date."
      inputs={
        <div>
          <span className="block text-sm font-medium mb-1.5">Birth date</span>
          <Input
            type="date"
            value={birth}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setBirth(e.target.value)}
            aria-label="Birth date"
            className="h-11"
          />
        </div>
      }
      result={
        age ? (
          <TableResult
            rows={[
              {
                label: 'Age',
                value: `${age.years} years ${age.months} months ${age.days} days`,
                emphasis: true,
              },
              { label: 'Total days', value: fmt(age.totalDays) },
              { label: 'Total hours', value: fmt(age.totalHours) },
              { label: 'Total minutes', value: fmt(age.totalMinutes) },
            ]}
          />
        ) : (
          <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
            Pick a date in the past.
          </div>
        )
      }
      onReset={() => setBirth(DEFAULT)}
    />
  );
}
