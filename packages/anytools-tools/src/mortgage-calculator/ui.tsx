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
import { amortize } from './logic';
import { STRINGS } from './strings';

export function MortgageCalculatorUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [home, setHome] = useState(400000);
  const [downPayment, setDownPayment] = useState(80000);
  const [ratePct, setRatePct] = useState(6.5);
  const [years, setYears] = useState(30);

  const principal = Math.max(0, home - downPayment);
  const { monthly, totalPaid, totalInterest } = amortize(principal, ratePct, years);
  const fmt = (n: number) =>
    n.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <>
          <CurrencyInput value={home} onChange={setHome} label={s.homePrice} />
          <CurrencyInput value={downPayment} onChange={setDownPayment} label={s.downPayment} />
          <RangeSlider
            value={ratePct}
            onChange={setRatePct}
            min={0}
            max={15}
            step={0.05}
            label={s.interestRate}
            unit="%"
          />
          <NumberStepper
            value={years}
            onChange={setYears}
            min={5}
            max={40}
            step={5}
            label={s.loanTerm}
            unit={s.unitYears}
          />
        </>
      }
      result={
        <TableResult
          rows={[
            { label: s.row_loanAmount, value: `$${fmt(principal)}` },
            { label: s.row_monthly, value: `$${fmt(monthly)}`, emphasis: true },
            { label: s.row_totalInterest, value: `$${fmt(totalInterest)}`, emphasis: true },
            { label: s.row_totalPaid, value: `$${fmt(totalPaid)}` },
          ]}
        />
      }
      onReset={() => {
        setHome(400000);
        setDownPayment(80000);
        setRatePct(6.5);
        setYears(30);
      }}
      disclaimer={s.disclaimer}
    />
  );
}
