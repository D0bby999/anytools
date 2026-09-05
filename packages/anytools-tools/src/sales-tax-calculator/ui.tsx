'use client';
import {
  CalculatorTemplate,
  CurrencyInput,
  RangeSlider,
  SegmentedControl,
  TableResult,
  useLocalized,
  useToolLocale,
} from '@anytools/ui';
import { useState } from 'react';
import { calcSalesTax } from './logic';
import { STRINGS } from './strings';

type Mode = 'add' | 'remove';

export function SalesTaxCalculatorUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [mode, setMode] = useState<Mode>('add');
  const [amount, setAmount] = useState(100);
  const [ratePct, setRatePct] = useState(8.25);

  const { pretax, tax, total } = calcSalesTax(amount, ratePct, mode);
  const fmt = (n: number) =>
    n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            options={[
              { value: 'add', label: s.addTax },
              { value: 'remove', label: s.removeTax },
            ]}
            label={s.mode}
          />
          <CurrencyInput
            value={amount}
            onChange={setAmount}
            label={mode === 'add' ? s.pretaxAmount : s.taxInclusiveTotal}
          />
          <RangeSlider
            value={ratePct}
            onChange={setRatePct}
            min={0}
            max={30}
            step={0.25}
            label={s.taxRate}
            unit="%"
          />
        </>
      }
      result={
        <TableResult
          rows={[
            { label: s.row_pretax, value: `$${fmt(pretax)}` },
            { label: s.row_tax.replace('{pct}', String(ratePct)), value: `$${fmt(tax)}` },
            { label: s.row_total, value: `$${fmt(total)}`, emphasis: true },
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
