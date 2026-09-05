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
import { calculateTip } from './logic';
import { STRINGS } from './strings';

export function TipCalculatorUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [bill, setBill] = useState(50);
  const [tipPct, setTipPct] = useState(18);
  const [people, setPeople] = useState(2);

  const { tip, total, perPerson } = calculateTip(bill, tipPct, people);
  const fmt = (n: number) =>
    n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <>
          <CurrencyInput value={bill} onChange={setBill} label={s.billAmount} />
          <RangeSlider
            value={tipPct}
            onChange={setTipPct}
            min={0}
            max={30}
            step={1}
            label={s.tipPercentage}
            unit="%"
          />
          <NumberStepper value={people} onChange={setPeople} min={1} max={50} label={s.people} />
        </>
      }
      result={
        <TableResult
          rows={[
            { label: s.row_subtotal, value: `$${fmt(bill)}` },
            { label: s.row_tip.replace('{pct}', String(tipPct)), value: `$${fmt(tip)}` },
            { label: s.row_total, value: `$${fmt(total)}`, emphasis: true },
            {
              label: s.row_perPerson.replace('{n}', String(people)),
              value: `$${fmt(perPerson)}`,
              emphasis: true,
            },
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
