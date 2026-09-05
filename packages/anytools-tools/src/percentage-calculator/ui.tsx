'use client';
import {
  CalculatorTemplate,
  Input,
  NumericPrimary,
  SegmentedControl,
  useLocalized,
  useToolLocale,
} from '@anytools/ui';
import { useState } from 'react';
import { type PercentMode, calcPercent } from './logic';
import { STRINGS } from './strings';

export function PercentageCalculatorUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [mode, setMode] = useState<PercentMode>('percentOf');
  const [a, setA] = useState(20);
  const [b, setB] = useState(150);

  const result = calcPercent(mode, a, b);
  // The logic layer phrases `label` in English; rebuild it here from the mode and operands.
  const resultLabel: Record<PercentMode, string> = {
    percentOf: s.resultPercentOf,
    whatPercent: s.resultWhatPercent,
    change: s.resultChange,
  };
  const label = resultLabel[result.mode]
    .replace('{a}', String(result.a))
    .replace('{b}', String(result.b));
  const { value, unit } = result;

  const reset = () => {
    setA(20);
    setB(150);
    setMode('percentOf');
  };

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            options={[
              { value: 'percentOf', label: s.modePercentOf },
              { value: 'whatPercent', label: s.modeWhatPercent },
              { value: 'change', label: s.modeChange },
            ]}
            label={s.mode}
          />
          <div>
            <span className="block text-sm font-medium mb-1.5">
              {mode === 'percentOf'
                ? s.percentageX
                : mode === 'whatPercent'
                  ? s.partX
                  : s.oldValueX}
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
              {mode === 'percentOf' ? s.ofValueY : mode === 'whatPercent' ? s.wholeY : s.newValueY}
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
          value={value.toLocaleString(locale, { maximumFractionDigits: 4 })}
          unit={unit}
        />
      }
      onReset={reset}
    />
  );
}
