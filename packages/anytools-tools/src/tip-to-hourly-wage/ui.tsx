'use client';
import {
  CalculatorTemplate,
  CurrencyInput,
  NumberStepper,
  TableResult,
  useLocalized,
  useToolLocale,
} from '@anytools/ui';
import { useState } from 'react';
import { calculateTipWage } from './logic';
import { STRINGS } from './strings';

export function TipToHourlyWageUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
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
    n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const perHour = (n: number) => s.perHour.replace('{amount}', `$${fmt(n)}`);

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <>
          <CurrencyInput value={tips} onChange={setTips} label={s.tipsEarned} />
          <CurrencyInput value={baseRate} onChange={setBaseRate} label={s.baseWage} />
          <NumberStepper
            value={hours}
            onChange={setHours}
            min={0.5}
            max={24}
            step={0.5}
            label={s.hoursWorked}
            unit="h"
          />
          <NumberStepper
            value={tipShareOut}
            onChange={setTipShareOut}
            min={0}
            max={50}
            step={1}
            label={s.tipOut}
            unit="%"
          />
        </>
      }
      result={
        <TableResult
          rows={[
            { label: s.row_netTips, value: `$${fmt(netTips)}` },
            { label: s.row_tipHourly, value: perHour(tipHourly) },
            { label: s.row_baseWage, value: perHour(baseRate) },
            { label: s.row_effective, value: perHour(effective), emphasis: true },
            {
              label: s.row_shift,
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
      disclaimer={s.disclaimer}
    />
  );
}
