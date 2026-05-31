'use client';
import {
  CalculatorTemplate,
  CurrencyInput,
  NumberStepper,
  RangeSlider,
  TableResult,
} from '@anytools/ui';
import { useState } from 'react';
import { calcCompoundInterest } from './logic';

export function CompoundInterestUi() {
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
    n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <CalculatorTemplate
      title="Compound Interest Calculator"
      description="Annual rate, compounded monthly, monthly contributions."
      inputs={
        <>
          <CurrencyInput value={principal} onChange={setPrincipal} label="Initial principal" />
          <CurrencyInput value={monthly} onChange={setMonthly} label="Monthly contribution" />
          <RangeSlider
            value={ratePct}
            onChange={setRatePct}
            min={0}
            max={20}
            step={0.25}
            label="Annual interest rate"
            unit="%"
          />
          <NumberStepper
            value={years}
            onChange={setYears}
            min={1}
            max={50}
            unit="yrs"
            label="Years"
          />
        </>
      }
      result={
        <TableResult
          rows={[
            { label: 'Final balance', value: `$${fmt(balance)}`, emphasis: true },
            { label: 'Total contributed', value: `$${fmt(totalContributed)}` },
            { label: 'Interest earned', value: `$${fmt(interest)}`, emphasis: true },
          ]}
        />
      }
      onReset={() => {
        setPrincipal(10000);
        setMonthly(200);
        setRatePct(7);
        setYears(20);
      }}
      disclaimer="Estimation only. Real returns vary with market conditions, taxes, and fees. Past performance does not guarantee future results."
    />
  );
}
