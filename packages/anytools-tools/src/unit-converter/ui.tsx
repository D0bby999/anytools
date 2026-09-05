'use client';
import {
  ConverterTemplate,
  Input,
  SegmentedControl,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useState } from 'react';
import { type Category, UNITS, convert } from './logic';
import { STRINGS } from './strings';

const DEFAULTS: Record<Category, [string, string]> = {
  length: ['m', 'ft'],
  weight: ['kg', 'lb'],
  temperature: ['C', 'F'],
  volume: ['L', 'gal_us'],
  speed: ['kph', 'mph'],
};

export function UnitConverterUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [category, setCategory] = useState<Category>('length');
  const [from, setFrom] = useState(DEFAULTS.length[0]);
  const [to, setTo] = useState(DEFAULTS.length[1]);
  const [value, setValue] = useState(1);

  const result = convert(category, from, to, value);

  const categoryOptions = [
    { value: 'length' as const, label: s.length },
    { value: 'weight' as const, label: s.weight },
    { value: 'temperature' as const, label: s.temperature },
    { value: 'volume' as const, label: s.volume },
    { value: 'speed' as const, label: s.speed },
  ];

  const switchCategory = (next: Category) => {
    setCategory(next);
    setFrom(DEFAULTS[next][0]);
    setTo(DEFAULTS[next][1]);
    setValue(1);
  };

  const units = UNITS[category];
  // The logic layer labels units in English; look each one up by id in the locale table.
  const unitLabel = (id: string, fallback: string) =>
    (s as Record<string, string>)[`unit_${id}`] ?? fallback;

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
        aria-label={s.unitFor.replace('{label}', label)}
      >
        {units.map((u) => (
          <option key={u.id} value={u.id}>
            {unitLabel(u.id, u.label)}
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
        aria-label={s.valueFor.replace('{label}', label)}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <SegmentedControl
        value={category}
        onChange={switchCategory}
        options={categoryOptions}
        label={s.category}
      />
      <ConverterTemplate
        source={
          <Pane selected={from} onSelect={setFrom} val={value} onVal={setValue} label={ui.from} />
        }
        target={<Pane selected={to} onSelect={setTo} val={result} readOnly label={ui.to} />}
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
