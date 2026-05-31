'use client';
import {
  CalculatorTemplate,
  CurrencyInput,
  RangeSlider,
  SegmentedControl,
  TableResult,
} from '@anytools/ui';
import { useState } from 'react';
import { calcSalesTax } from './logic';

type Mode = 'add' | 'remove';

export function SalesTaxCalculatorUi() {
  const [mode, setMode] = useState<Mode>('add');
  const [amount, setAmount] = useState(100);
  const [ratePct, setRatePct] = useState(8.25);

  const { pretax, tax, total } = calcSalesTax(amount, ratePct, mode);
  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <CalculatorTemplate
      title="Sales Tax Calculator"
      description="Add tax to a pre-tax price, or strip tax from a tax-inclusive total."
      inputs={
        <>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            options={[
              { value: 'add', label: 'Add tax' },
              { value: 'remove', label: 'Remove tax' },
            ]}
            label="Mode"
          />
          <CurrencyInput
            value={amount}
            onChange={setAmount}
            label={mode === 'add' ? 'Pre-tax amount' : 'Tax-inclusive total'}
          />
          <RangeSlider
            value={ratePct}
            onChange={setRatePct}
            min={0}
            max={30}
            step={0.25}
            label="Tax rate"
            unit="%"
          />
        </>
      }
      result={
        <TableResult
          rows={[
            { label: 'Pre-tax', value: `$${fmt(pretax)}` },
            { label: `Tax (${ratePct}%)`, value: `$${fmt(tax)}` },
            { label: 'Total', value: `$${fmt(total)}`, emphasis: true },
          ]}
        />
      }
      onReset={() => {
        setMode('add');
        setAmount(100);
        setRatePct(8.25);
      }}
    />
  );
}
