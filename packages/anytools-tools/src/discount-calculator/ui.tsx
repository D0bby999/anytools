'use client';
import {
  CalculatorTemplate,
  CurrencyInput,
  RangeSlider,
  TableResult,
  useLocalized,
  useToolLocale,
} from '@anytools/ui';
import { useState } from 'react';
import { calcDiscount } from './logic';
import { STRINGS } from './strings';

export function DiscountCalculatorUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [price, setPrice] = useState(100);
  const [discountPct, setDiscountPct] = useState(25);
  const [taxPct, setTaxPct] = useState(0);

  const { discount, afterDiscount, tax, final } = calcDiscount(price, discountPct, taxPct);
  const fmt = (n: number) =>
    n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <>
          <CurrencyInput value={price} onChange={setPrice} label={s.originalPrice} />
          <RangeSlider
            value={discountPct}
            onChange={setDiscountPct}
            min={0}
            max={90}
            step={1}
            label={s.discount}
            unit="%"
          />
          <RangeSlider
            value={taxPct}
            onChange={setTaxPct}
            min={0}
            max={25}
            step={0.25}
            label={s.taxOptional}
            unit="%"
          />
        </>
      }
      result={
        <TableResult
          rows={[
            { label: s.row_original, value: `$${fmt(price)}` },
            {
              label: s.row_discount.replace('{pct}', String(discountPct)),
              value: `−$${fmt(discount)}`,
            },
            { label: s.row_afterDiscount, value: `$${fmt(afterDiscount)}` },
            ...(taxPct > 0
              ? [{ label: s.row_tax.replace('{pct}', String(taxPct)), value: `+$${fmt(tax)}` }]
              : []),
            { label: s.row_final, value: `$${fmt(final)}`, emphasis: true },
            { label: s.row_save, value: `$${fmt(price - final)}`, emphasis: true },
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
