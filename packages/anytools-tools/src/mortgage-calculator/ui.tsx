'use client';
import {
  CalculatorTemplate,
  CurrencyInput,
  NumberStepper,
  RangeSlider,
  TableResult,
} from '@anytools/ui';
import { useState } from 'react';
import { amortize } from './logic';

export function MortgageCalculatorUi() {
  const [home, setHome] = useState(400000);
  const [downPayment, setDownPayment] = useState(80000);
  const [ratePct, setRatePct] = useState(6.5);
  const [years, setYears] = useState(30);

  const principal = Math.max(0, home - downPayment);
  const { monthly, totalPaid, totalInterest } = amortize(principal, ratePct, years);
  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <CalculatorTemplate
      title="Mortgage Calculator"
      description="Monthly payment + total interest. User-input rate."
      inputs={
        <>
          <CurrencyInput value={home} onChange={setHome} label="Home price" />
          <CurrencyInput value={downPayment} onChange={setDownPayment} label="Down payment" />
          <RangeSlider
            value={ratePct}
            onChange={setRatePct}
            min={0}
            max={15}
            step={0.05}
            label="Interest rate"
            unit="%"
          />
          <NumberStepper
            value={years}
            onChange={setYears}
            min={5}
            max={40}
            step={5}
            label="Loan term"
            unit="yrs"
          />
        </>
      }
      result={
        <TableResult
          rows={[
            { label: 'Loan amount', value: `$${fmt(principal)}` },
            { label: 'Monthly payment', value: `$${fmt(monthly)}`, emphasis: true },
            { label: 'Total interest', value: `$${fmt(totalInterest)}`, emphasis: true },
            { label: 'Total paid', value: `$${fmt(totalPaid)}` },
          ]}
        />
      }
      onReset={() => {
        setHome(400000);
        setDownPayment(80000);
        setRatePct(6.5);
        setYears(30);
      }}
      disclaimer="Estimation only. Does not include property tax, PMI, HOA, or insurance. Consult a lender for accurate quotes."
    />
  );
}
