'use client';
import { CalculatorTemplate, Input, NumericPrimary, SegmentedControl } from '@anytools/ui';
import { useState } from 'react';
import { type PercentMode, calcPercent } from './logic';

export function PercentageCalculatorUi() {
  const [mode, setMode] = useState<PercentMode>('percentOf');
  const [a, setA] = useState(20);
  const [b, setB] = useState(150);

  const { value, label, unit } = calcPercent(mode, a, b);

  const reset = () => {
    setA(20);
    setB(150);
    setMode('percentOf');
  };

  return (
    <CalculatorTemplate
      title="Percentage Calculator"
      description="Tip, discount, tax, grade, growth — three percentage modes."
      inputs={
        <>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            options={[
              { value: 'percentOf', label: 'X% of Y' },
              { value: 'whatPercent', label: 'X = ?% of Y' },
              { value: 'change', label: '% change' },
            ]}
            label="Mode"
          />
          <div>
            <span className="block text-sm font-medium mb-1.5">
              {mode === 'percentOf'
                ? 'Percentage (X)'
                : mode === 'whatPercent'
                  ? 'Part (X)'
                  : 'Old value (X)'}
            </span>
            <Input
              type="number"
              inputMode="decimal"
              value={a}
              onChange={(e) => setA(e.target.valueAsNumber || 0)}
              className="h-11 text-base tabular-nums"
              aria-label="X"
            />
          </div>
          <div>
            <span className="block text-sm font-medium mb-1.5">
              {mode === 'percentOf'
                ? 'Of value (Y)'
                : mode === 'whatPercent'
                  ? 'Whole (Y)'
                  : 'New value (Y)'}
            </span>
            <Input
              type="number"
              inputMode="decimal"
              value={b}
              onChange={(e) => setB(e.target.valueAsNumber || 0)}
              className="h-11 text-base tabular-nums"
              aria-label="Y"
            />
          </div>
        </>
      }
      result={
        <NumericPrimary
          label={label}
          value={value.toLocaleString(undefined, { maximumFractionDigits: 4 })}
          unit={unit}
        />
      }
      onReset={reset}
    />
  );
}
