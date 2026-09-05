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
import { calcCompoundInterest } from './logic';
import { STRINGS } from './strings';

export function CompoundInterestUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [principal, setPrincipal] = useState(10000);
  const [monthly, setMonthly] = useState(200);
  const [ratePct, setRatePct] = useState(7);
  const [years, setYears] = useState(20);

  const { balance, totalContributed, interest } = calcCompoundInterest(
    principal,
    monthly,
    ratePct,
    years,
  );
  const fmt = (n: number) =>
    n.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <>
          <CurrencyInput value={principal} onChange={setPrincipal} label={s.initialPrincipal} />
          <CurrencyInput value={monthly} onChange={setMonthly} label={s.monthlyContribution} />
          <RangeSlider
            value={ratePct}
            onChange={setRatePct}
            min={0}
            max={20}
            step={0.25}
            label={s.annualRate}
            unit="%"
          />
          <NumberStepper
            value={years}
            onChange={setYears}
            min={1}
            max={50}
            unit={s.unitYears}
            label={s.years}
          />
        </>
      }
      result={
        <TableResult
          rows={[
            { label: s.row_finalBalance, value: `$${fmt(balance)}`, emphasis: true },
            { label: s.row_totalContributed, value: `$${fmt(totalContributed)}` },
            { label: s.row_interestEarned, value: `$${fmt(interest)}`, emphasis: true },
          ]}
        />
      }
      onReset={() => {
        setPrincipal(10000);
        setMonthly(200);
        setRatePct(7);
        setYears(20);
      }}
      disclaimer={s.disclaimer}
    />
  );
}
