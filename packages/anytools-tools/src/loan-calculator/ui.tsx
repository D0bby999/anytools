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

export function LoanCalculatorUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [amount, setAmount] = useState(20000);
  const [ratePct, setRatePct] = useState(8.5);
  const [months, setMonths] = useState(60);

  const { monthly, total, interest } = amortize(amount, ratePct, months);
  const fmt = (n: number) =>
    n.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <>
          <CurrencyInput value={amount} onChange={setAmount} label={s.loanAmount} />
          <RangeSlider
            value={ratePct}
            onChange={setRatePct}
            min={0}
            max={30}
            step={0.25}
            label={s.annualRate}
            unit="%"
          />
          <NumberStepper
            value={months}
            onChange={setMonths}
            min={6}
            max={360}
            step={6}
            label={s.term}
            unit={s.unitMonths}
          />
        </>
      }
      result={
        <TableResult
          rows={[
            { label: s.row_monthly, value: `$${fmt(monthly)}`, emphasis: true },
            { label: s.row_totalInterest, value: `$${fmt(interest)}`, emphasis: true },
            { label: s.row_totalPaid, value: `$${fmt(total)}` },
            {
              label: s.row_term,
              value: s.termValue
                .replace('{months}', String(months))
                .replace('{years}', String(Math.round(months / 12))),
            },
          ]}
        />
      }
      onReset={() => {
        setAmount(20000);
        setRatePct(8.5);
        setMonths(60);
      }}
      disclaimer={s.disclaimer}
    />
  );
}
