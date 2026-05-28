'use client';
import { useState } from 'react';
import { NumberStepper } from './number-stepper';
import { SegmentedControl } from './segmented-control';

type Unit = 'metric' | 'imperial';
type Props = {
  /** Weight in kilograms (canonical) */
  kg: number;
  onChange: (kg: number) => void;
  label?: string;
  className?: string;
};

const KG_PER_LB = 0.45359237;

/**
 * Weight input with unit toggle. Canonical storage = kilograms.
 */
export function WeightInput({ kg, onChange, label = 'Weight', className }: Props) {
  const [unit, setUnit] = useState<Unit>('metric');
  const lb = kg / KG_PER_LB;

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm font-medium">{label}</span>
        <SegmentedControl
          value={unit}
          onChange={setUnit}
          options={[
            { value: 'metric', label: 'kg' },
            { value: 'imperial', label: 'lb' },
          ]}
          ariaLabel="Weight unit"
          className="w-40"
        />
      </div>
      {unit === 'metric' ? (
        <NumberStepper
          value={Math.round(kg * 10) / 10}
          onChange={onChange}
          min={20}
          max={300}
          step={0.5}
          unit="kg"
          ariaLabel="Weight in kilograms"
        />
      ) : (
        <NumberStepper
          value={Math.round(lb)}
          onChange={(v) => onChange(v * KG_PER_LB)}
          min={44}
          max={660}
          step={1}
          unit="lb"
          ariaLabel="Weight in pounds"
        />
      )}
    </div>
  );
}
