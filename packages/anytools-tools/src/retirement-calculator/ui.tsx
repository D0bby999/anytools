'use client';
import {
  CalculatorTemplate,
  CurrencyInput,
  NumberStepper,
  RangeSlider,
  TableResult,
  useLocalized,
  useToolLocale,
} from '@anytools/ui';
import { useState } from 'react';
import { calcRetirement } from './logic';
import { STRINGS } from './strings';

export function RetirementCalculatorUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [currentSavings, setCurrentSavings] = useState(25000);
  const [monthly, setMonthly] = useState(500);
  const [currentAge, setCurrentAge] = useState(30);
  const [retireAge, setRetireAge] = useState(65);
  const [ratePct, setRatePct] = useState(7);

  const { years, balance, totalContributed, interest, safe4pct } = calcRetirement(
    currentSavings,
    monthly,
    currentAge,
    retireAge,
    ratePct,
  );

  const fmt = (n: number) =>
    n.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <>
          <CurrencyInput
            value={currentSavings}
            onChange={setCurrentSavings}
            label={s.currentSavings}
          />
          <CurrencyInput value={monthly} onChange={setMonthly} label={s.monthlyContribution} />
          <NumberStepper
            value={currentAge}
            onChange={setCurrentAge}
            min={18}
            max={80}
            label={s.currentAge}
          />
          <NumberStepper
            value={retireAge}
            onChange={setRetireAge}
            min={40}
            max={90}
            label={s.retirementAge}
          />
          <RangeSlider
            value={ratePct}
            onChange={setRatePct}
            min={0}
            max={15}
            step={0.25}
            label={s.annualReturn}
            unit="%"
          />
        </>
      }
      result={
        <TableResult
          rows={[
            { label: s.row_years, value: s.yearsValue.replace('{n}', String(years)) },
            { label: s.row_totalContributed, value: `$${fmt(totalContributed)}` },
            { label: s.row_interestEarned, value: `$${fmt(interest)}` },
            { label: s.row_balance, value: `$${fmt(balance)}`, emphasis: true },
            {
              label: s.row_safe,
              value: s.perYear.replace('{amount}', `$${fmt(safe4pct)}`),
              emphasis: true,
            },
            { label: s.row_perMonth, value: `$${fmt(safe4pct / 12)}` },
          ]}
        />
      }
      onReset={() => {
        setCurrentSavings(25000);
        setMonthly(500);
        setCurrentAge(30);
        setRetireAge(65);
        setRatePct(7);
      }}
      disclaimer={s.disclaimer}
    />
  );
}
