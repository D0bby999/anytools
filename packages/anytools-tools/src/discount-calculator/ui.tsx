'use client';
import { CalculatorTemplate, CurrencyInput, RangeSlider, TableResult } from '@anytools/ui';
import { useState } from 'react';
import { calcDiscount } from './logic';

export function DiscountCalculatorUi() {
  const [price, setPrice] = useState(100);
  const [discountPct, setDiscountPct] = useState(25);
  const [taxPct, setTaxPct] = useState(0);

  const { discount, afterDiscount, tax, final } = calcDiscount(price, discountPct, taxPct);
  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <CalculatorTemplate
      title="Discount Calculator"
      description="Original price + discount % → final price."
      inputs={
        <>
          <CurrencyInput value={price} onChange={setPrice} label="Original price" />
          <RangeSlider
            value={discountPct}
            onChange={setDiscountPct}
            min={0}
            max={90}
            step={1}
            label="Discount"
            unit="%"
          />
          <RangeSlider
            value={taxPct}
            onChange={setTaxPct}
            min={0}
            max={25}
            step={0.25}
            label="Tax (optional)"
            unit="%"
          />
        </>
      }
      result={
        <TableResult
          rows={[
            { label: 'Original', value: `$${fmt(price)}` },
            { label: `Discount (${discountPct}%)`, value: `−$${fmt(discount)}` },
            { label: 'After discount', value: `$${fmt(afterDiscount)}` },
            ...(taxPct > 0 ? [{ label: `Tax (${taxPct}%)`, value: `+$${fmt(tax)}` }] : []),
            { label: 'Final price', value: `$${fmt(final)}`, emphasis: true },
            { label: 'You save', value: `$${fmt(price - final)}`, emphasis: true },
          ]}
        />
      }
      onReset={() => {
        setPrice(100);
        setDiscountPct(25);
        setTaxPct(0);
      }}
    />
  );
}
