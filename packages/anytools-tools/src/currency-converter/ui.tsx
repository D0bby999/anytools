'use client';
import { ConverterTemplate, Input, useLocalized, useToolLocale, useUiStrings } from '@anytools/ui';
import { useEffect, useState } from 'react';
import { convertCurrency, extractRate } from './logic';
import { STRINGS } from './strings';

const COMMON = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'AUD',
  'CAD',
  'CHF',
  'CNY',
  'INR',
  'KRW',
  'SGD',
  'HKD',
  'NZD',
  'SEK',
  'NOK',
  'DKK',
  'MXN',
  'BRL',
  'ZAR',
  'TRY',
  'PLN',
  'CZK',
  'HUF',
  'IDR',
  'MYR',
  'PHP',
  'THB',
  'VND',
  'ILS',
  'AED',
];

type RatesPayload = { base: string; date: string; rates: Record<string, number> };

async function fetchRates(base: string): Promise<RatesPayload | null> {
  try {
    const res = await fetch(`/api/fx?base=${encodeURIComponent(base)}`, { cache: 'force-cache' });
    if (!res.ok) return null;
    return (await res.json()) as RatesPayload;
  } catch {
    return null;
  }
}

export function CurrencyConverterUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const locale = useToolLocale();
  const [from, setFrom] = useState('USD');
  const [to, setTo] = useState('EUR');
  const [amount, setAmount] = useState(100);
  const [rates, setRates] = useState<RatesPayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchRates(from).then((r) => {
      setRates(r);
      setLoading(false);
    });
  }, [from]);

  const rate = rates ? extractRate(from, to, rates.rates, rates.base) : from === to ? 1 : null;
  const result = rates
    ? (convertCurrency(amount, from, to, rates.rates, rates.base) ?? 0)
    : from === to
      ? amount
      : 0;
  const fmt = (n: number) =>
    n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  const Pane = ({
    selected,
    onSelect,
    val,
    onVal,
    readOnly,
    label,
    currencyAria,
    amountAria,
  }: {
    selected: string;
    onSelect: (id: string) => void;
    val: number;
    onVal?: (n: number) => void;
    readOnly?: boolean;
    label: string;
    currencyAria: string;
    amountAria: string;
  }) => (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <select
        value={selected}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full h-11 rounded-md border bg-background px-2 text-sm font-mono"
        aria-label={currencyAria}
      >
        {COMMON.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <Input
        type="number"
        inputMode="decimal"
        value={Number.isFinite(val) ? Number(val.toFixed(4)) : 0}
        onChange={(e) => onVal?.(e.target.valueAsNumber || 0)}
        readOnly={readOnly}
        className="h-12 text-xl tabular-nums font-semibold"
        aria-label={amountAria}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <ConverterTemplate
        title={s.title}
        description={
          loading
            ? s.loadingRates
            : rates
              ? s.ratesFrom.replace('{date}', rates.date)
              : s.ratesUnavailable
        }
        source={
          <Pane
            selected={from}
            onSelect={setFrom}
            val={amount}
            onVal={setAmount}
            label={ui.from}
            currencyAria={s.fromCurrency}
            amountAria={s.fromAmount}
          />
        }
        target={
          <Pane
            selected={to}
            onSelect={setTo}
            val={result}
            label={ui.to}
            currencyAria={s.toCurrency}
            amountAria={s.toAmount}
            readOnly
          />
        }
        onSwap={() => {
          const oldFrom = from;
          setFrom(to);
          setTo(oldFrom);
          setAmount(result);
        }}
        disclaimer={
          rate && from !== to
            ? s.rateNote.replace('{from}', from).replace('{rate}', fmt(rate)).replace('{to}', to)
            : undefined
        }
      />
    </div>
  );
}
