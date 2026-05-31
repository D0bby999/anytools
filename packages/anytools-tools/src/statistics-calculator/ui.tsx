'use client';
import { SegmentedControl, TableResult, Textarea } from '@anytools/ui';
import { useState } from 'react';
import { computeStats, parseNumbers } from './logic';
import type { PopulationType } from './logic';

type Pop = PopulationType;

export function StatisticsCalculatorUi() {
  const [input, setInput] = useState('4, 8, 15, 16, 23, 42');
  const [pop, setPop] = useState<Pop>('sample');

  const nums = parseNumbers(input);
  const s = computeStats(nums, pop);
  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 });

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold mb-1">Statistics Calculator</h2>
        <p className="text-sm text-muted-foreground">
          Comma-, space-, or newline-separated numbers.
        </p>
      </header>
      <SegmentedControl
        value={pop}
        onChange={setPop}
        options={[
          { value: 'sample', label: 'Sample (n−1)' },
          { value: 'population', label: 'Population (n)' },
        ]}
        label="Variance/StdDev mode"
      />
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="4, 8, 15, 16, 23, 42"
            className="min-h-[300px] font-mono text-sm"
            aria-label="Numbers"
          />
        </div>
        <div className="lg:col-span-2 lg:sticky lg:top-20 lg:self-start">
          {s ? (
            <TableResult
              rows={[
                { label: 'Count (n)', value: fmt(s.n) },
                { label: 'Sum', value: fmt(s.sum) },
                { label: 'Mean', value: fmt(s.mean), emphasis: true },
                { label: 'Median', value: fmt(s.median), emphasis: true },
                {
                  label: 'Mode',
                  value:
                    s.modes.length === s.n
                      ? 'no mode (all unique)'
                      : s.modes.length > 5
                        ? `multi-modal (${s.modes.length})`
                        : s.modes.map(fmt).join(', '),
                },
                { label: 'Std Dev', value: fmt(s.stdDev), emphasis: true },
                { label: 'Variance', value: fmt(s.variance) },
                { label: 'Min / Max', value: `${fmt(s.min)} / ${fmt(s.max)}` },
                { label: 'Range', value: fmt(s.range) },
                { label: 'Q1 / Q3', value: `${fmt(s.q1)} / ${fmt(s.q3)}` },
              ]}
            />
          ) : (
            <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
              Enter numbers.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
