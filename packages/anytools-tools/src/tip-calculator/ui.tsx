'use client';
import {
  CalculatorTemplate,
  CurrencyInput,
  NumberStepper,
  RangeSlider,
  TableResult,
} from '@anytools/ui';
import { useState } from 'react';
import { calculateTip } from './logic';

export function TipCalculatorUi() {
  const [bill, setBill] = useState(50);
  const [tipPct, setTipPct] = useState(18);
  const [people, setPeople] = useState(2);

  const { tip, total, perPerson } = calculateTip(bill, tipPct, people);
  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <CalculatorTemplate
      title="Tip Calculator + Bill Splitter"
      description="Add tip percentage and split the total across people."
      inputs={
        <>
          <CurrencyInput value={bill} onChange={setBill} label="Bill amount" />
          <RangeSlider
            value={tipPct}
            onChange={setTipPct}
            min={0}
            max={30}
            step={1}
            label="Tip percentage"
            unit="%"
          />
          <NumberStepper value={people} onChange={setPeople} min={1} max={50} label="People" />
        </>
      }
      result={
        <TableResult
          rows={[
            { label: 'Subtotal', value: `$${fmt(bill)}` },
            { label: `Tip (${tipPct}%)`, value: `$${fmt(tip)}` },
            { label: 'Total', value: `$${fmt(total)}`, emphasis: true },
            { label: `Per person (÷${people})`, value: `$${fmt(perPerson)}`, emphasis: true },
          ]}
        />
      }
      onReset={() => {
        setBill(50);
        setTipPct(18);
        setPeople(2);
      }}
    />
  );
}
