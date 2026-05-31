'use client';
import { CalculatorTemplate, CurrencyInput, NumberStepper, TableResult } from '@anytools/ui';
import { useState } from 'react';
import { calculateTipWage } from './logic';

export function TipToHourlyWageUi() {
  const [tips, setTips] = useState(120);
  const [baseRate, setBaseRate] = useState(2.13);
  const [hours, setHours] = useState(6);
  const [tipShareOut, setTipShareOut] = useState(15);

  const { netTips, tipHourly, effective, shiftEarnings } = calculateTipWage(
    tips,
    baseRate,
    hours,
    tipShareOut,
  );
  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <CalculatorTemplate
      title="Tip → Hourly Wage"
      description="Effective hourly rate for tipped workers."
      inputs={
        <>
          <CurrencyInput value={tips} onChange={setTips} label="Tips earned this shift" />
          <CurrencyInput value={baseRate} onChange={setBaseRate} label="Base hourly wage" />
          <NumberStepper
            value={hours}
            onChange={setHours}
            min={0.5}
            max={24}
            step={0.5}
            label="Hours worked"
            unit="h"
          />
          <NumberStepper
            value={tipShareOut}
            onChange={setTipShareOut}
            min={0}
            max={50}
            step={1}
            label="Tip-out to bus/runner/etc"
            unit="%"
          />
        </>
      }
      result={
        <TableResult
          rows={[
            { label: 'Tips (post tip-out)', value: `$${fmt(netTips)}` },
            { label: 'Tip hourly', value: `$${fmt(tipHourly)}/h` },
            { label: 'Base wage', value: `$${fmt(baseRate)}/h` },
            { label: 'Effective hourly', value: `$${fmt(effective)}/h`, emphasis: true },
            {
              label: 'Shift earnings',
              value: `$${fmt(shiftEarnings)}`,
              emphasis: true,
            },
          ]}
        />
      }
      onReset={() => {
        setTips(120);
        setBaseRate(2.13);
        setHours(6);
        setTipShareOut(15);
      }}
      disclaimer="Estimation. Excludes income tax, payroll tax, and FICA. Real take-home is lower."
    />
  );
}
