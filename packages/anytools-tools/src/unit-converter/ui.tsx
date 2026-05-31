'use client';
import { ConverterTemplate, Input, SegmentedControl } from '@anytools/ui';
import { useState } from 'react';
import { type Category, UNITS, convert } from './logic';

const CATEGORY_OPTIONS = [
  { value: 'length' as const, label: 'Length' },
  { value: 'weight' as const, label: 'Weight' },
  { value: 'temperature' as const, label: 'Temp' },
  { value: 'volume' as const, label: 'Volume' },
  { value: 'speed' as const, label: 'Speed' },
];

const DEFAULTS: Record<Category, [string, string]> = {
  length: ['m', 'ft'],
  weight: ['kg', 'lb'],
  temperature: ['C', 'F'],
  volume: ['L', 'gal_us'],
  speed: ['kph', 'mph'],
};

export function UnitConverterUi() {
  const [category, setCategory] = useState<Category>('length');
  const [from, setFrom] = useState(DEFAULTS.length[0]);
  const [to, setTo] = useState(DEFAULTS.length[1]);
  const [value, setValue] = useState(1);

  const result = convert(category, from, to, value);

  const switchCategory = (next: Category) => {
    setCategory(next);
    setFrom(DEFAULTS[next][0]);
    setTo(DEFAULTS[next][1]);
    setValue(1);
  };

  const units = UNITS[category];

  const Pane = ({
    selected,
    onSelect,
    val,
    onVal,
    readOnly,
    label,
  }: {
    selected: string;
    onSelect: (id: string) => void;
    val: number;
    onVal?: (n: number) => void;
    readOnly?: boolean;
    label: string;
  }) => (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <select
        value={selected}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full h-11 rounded-md border bg-background px-2 text-sm"
        aria-label={`${label} unit`}
      >
        {units.map((u) => (
          <option key={u.id} value={u.id}>
            {u.label}
          </option>
        ))}
      </select>
      <Input
        type="number"
        inputMode="decimal"
        value={Number.isFinite(val) ? Number(val.toFixed(6)) : 0}
        onChange={(e) => onVal?.(e.target.valueAsNumber || 0)}
        readOnly={readOnly}
        className="h-12 text-xl tabular-nums font-semibold"
        aria-label={`${label} value`}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <SegmentedControl
        value={category}
        onChange={switchCategory}
        options={CATEGORY_OPTIONS}
        label="Category"
      />
      <ConverterTemplate
        source={
          <Pane selected={from} onSelect={setFrom} val={value} onVal={setValue} label="From" />
        }
        target={<Pane selected={to} onSelect={setTo} val={result} readOnly label="To" />}
        onSwap={() => {
          const oldFrom = from;
          setFrom(to);
          setTo(oldFrom);
          setValue(result);
        }}
      />
    </div>
  );
}
