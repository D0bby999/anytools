'use client';
import { useState } from 'react';
import { Input } from '../input';

type Props = {
  value: number;
  onChange: (next: number) => void;
  symbol?: string;
  label?: string;
  placeholder?: string;
  className?: string;
};

/**
 * Currency input with symbol prefix. Stores raw number, displays formatted
 * with thousand separators on blur. Editable as plain number while focused.
 */
export function CurrencyInput({
  value,
  onChange,
  symbol = '$',
  label,
  placeholder,
  className,
}: Props) {
  const [focused, setFocused] = useState(false);
  const display = focused
    ? value === 0
      ? ''
      : String(value)
    : value === 0
      ? ''
      : value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  return (
    <div className={className}>
      {label && <span className="block text-sm font-medium mb-1.5">{label}</span>}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground pointer-events-none">
          {symbol}
        </span>
        <Input
          type="text"
          inputMode="decimal"
          value={display}
          placeholder={placeholder ?? '0'}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9.]/g, '');
            const n = Number.parseFloat(raw);
            onChange(Number.isFinite(n) ? n : 0);
          }}
          aria-label={label}
          className="h-11 pl-7 text-base tabular-nums"
        />
      </div>
    </div>
  );
}
