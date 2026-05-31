'use client';
import {
  CalculatorTemplate,
  CurrencyInput,
  NumberStepper,
  RangeSlider,
  TableResult,
} from '@anytools/ui';
import { useState } from 'react';
import { calcRetirement } from './logic';

export function RetirementCalculatorUi() {
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
    n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <CalculatorTemplate
      title="Retirement Calculator"
      description="Project balance at retirement + safe-withdrawal annual income."
      inputs={
        <>
          <CurrencyInput
            value={currentSavings}
            onChange={setCurrentSavings}
            label="Current savings"
          />
          <CurrencyInput value={monthly} onChange={setMonthly} label="Monthly contribution" />
          <NumberStepper
            value={currentAge}
            onChange={setCurrentAge}
            min={18}
            max={80}
            label="Current age"
          />
          <NumberStepper
            value={retireAge}
            onChange={setRetireAge}
            min={40}
            max={90}
            label="Retirement age"
          />
          <RangeSlider
            value={ratePct}
            onChange={setRatePct}
            min={0}
            max={15}
            step={0.25}
            label="Annual return rate"
            unit="%"
          />
        </>
      }
      result={
        <TableResult
          rows={[
            { label: 'Years to retire', value: `${years} yrs` },
            { label: 'Total contributed', value: `$${fmt(totalContributed)}` },
            { label: 'Interest earned', value: `$${fmt(interest)}` },
            { label: 'Balance at retirement', value: `$${fmt(balance)}`, emphasis: true },
            { label: 'Safe withdrawal (4% rule)', value: `$${fmt(safe4pct)}/yr`, emphasis: true },
            { label: '… per month', value: `$${fmt(safe4pct / 12)}` },
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
      disclaimer="Estimation only. Real returns vary with market, inflation, taxes, and fees. The 4% rule assumes a balanced portfolio and is a guideline, not a guarantee."
    />
  );
}
