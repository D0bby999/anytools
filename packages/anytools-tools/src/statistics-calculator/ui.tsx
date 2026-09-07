'use client';
import {
  CalculatorTemplate,
  SegmentedControl,
  TableResult,
  Textarea,
  useLocalized,
  useToolLocale,
} from '@anytools/ui';
import { useState } from 'react';
import { computeStats, parseNumbers } from './logic';
import type { PopulationType } from './logic';
import { STRINGS } from './strings';

type Pop = PopulationType;

export function StatisticsCalculatorUi() {
  const t = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [input, setInput] = useState('4, 8, 15, 16, 23, 42');
  const [pop, setPop] = useState<Pop>('sample');

  const nums = parseNumbers(input);
  const s = computeStats(nums, pop);
  const fmt = (n: number) =>
    n.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 4 });

  return (
    <CalculatorTemplate
      title={t.title}
      description={t.description}
      inputs={
        <>
          <SegmentedControl
            value={pop}
            onChange={setPop}
            options={[
              { value: 'sample', label: t.sample },
              { value: 'population', label: t.population },
            ]}
            label={t.varianceMode}
          />
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="4, 8, 15, 16, 23, 42"
            className="min-h-[300px] font-mono text-sm"
            aria-label={t.numbers}
          />
        </>
      }
      result={
        s ? (
          <TableResult
            rows={[
              { label: t.count, value: fmt(s.n) },
              { label: t.sum, value: fmt(s.sum) },
              { label: t.mean, value: fmt(s.mean), emphasis: true },
              { label: t.median, value: fmt(s.median), emphasis: true },
              {
                label: t.mode,
                value:
                  s.modes.length === s.n
                    ? t.noMode
                    : s.modes.length > 5
                      ? t.multiModal.replace('{n}', String(s.modes.length))
                      : s.modes.map(fmt).join(', '),
              },
              { label: t.stdDev, value: fmt(s.stdDev), emphasis: true },
              { label: t.variance, value: fmt(s.variance) },
              { label: t.minMax, value: `${fmt(s.min)} / ${fmt(s.max)}` },
              { label: t.range, value: fmt(s.range) },
              { label: t.q1q3, value: `${fmt(s.q1)} / ${fmt(s.q3)}` },
            ]}
          />
        ) : (
          <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
            {t.enterNumbers}
          </div>
        )
      }
    />
  );
}
