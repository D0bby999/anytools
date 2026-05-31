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

export function LoanCalculatorUi() {
  const [amount, setAmount] = useState(20000);
  const [ratePct, setRatePct] = useState(8.5);
  const [months, setMonths] = useState(60);

  const { monthly, total, interest } = amortize(amount, ratePct, months);
  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <CalculatorTemplate
      title="Loan Calculator"
      description="Auto, personal, student. Monthly payment + total interest."
      inputs={
        <>
          <CurrencyInput value={amount} onChange={setAmount} label="Loan amount" />
          <RangeSlider
            value={ratePct}
            onChange={setRatePct}
            min={0}
            max={30}
            step={0.25}
            label="Annual interest rate"
            unit="%"
          />
          <NumberStepper
            value={months}
            onChange={setMonths}
            min={6}
            max={360}
            step={6}
            label="Term"
            unit="mo"
          />
        </>
      }
      result={
        <TableResult
          rows={[
            { label: 'Monthly payment', value: `$${fmt(monthly)}`, emphasis: true },
            { label: 'Total interest', value: `$${fmt(interest)}`, emphasis: true },
            { label: 'Total paid', value: `$${fmt(total)}` },
            { label: 'Term', value: `${months} months (${Math.round(months / 12)} yr)` },
          ]}
        />
      }
      onReset={() => {
        setAmount(20000);
        setRatePct(8.5);
        setMonths(60);
      }}
      disclaimer="Estimation only. Real loan terms include origination fees and may use different compounding."
    />
  );
}
