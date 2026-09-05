'use client';
import { useState } from 'react';
import { useUiStrings } from '../../i18n/ui-strings';
import { NumberStepper } from './number-stepper';
import { SegmentedControl } from './segmented-control';

type Unit = 'metric' | 'imperial';
type Props = {
  /** Height in centimeters (canonical) */
  cm: number;
  onChange: (cm: number) => void;
  label?: string;
  className?: string;
};

const CM_PER_INCH = 2.54;
const INCHES_PER_FOOT = 12;

/**
 * Height input with unit toggle. Canonical storage = centimeters.
 * Imperial mode: separate ft + in steppers. Metric: single cm stepper.
 */
export function HeightInput({ cm, onChange, label: labelProp, className }: Props) {
  const ui = useUiStrings();
  const label = labelProp ?? ui.height;
  const [unit, setUnit] = useState<Unit>('metric');

  const totalInches = cm / CM_PER_INCH;
  let ft = Math.floor(totalInches / INCHES_PER_FOOT);
  let inches = Math.round(totalInches % INCHES_PER_FOOT);
  // Carry: rounding can push remainder to 12 (e.g. cm=174.6 → 11.93 → 12).
  if (inches === INCHES_PER_FOOT) {
    ft += 1;
    inches = 0;
  }

  const setFromImperial = (newFt: number, newIn: number) => {
    onChange(Math.round((newFt * INCHES_PER_FOOT + newIn) * CM_PER_INCH));
  };

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-sm font-medium">{label}</span>
        <SegmentedControl
          value={unit}
          onChange={setUnit}
          options={[
            { value: 'metric', label: 'cm' },
            { value: 'imperial', label: 'ft+in' },
          ]}
          ariaLabel="Height unit"
          className="w-40"
        />
      </div>
      {unit === 'metric' ? (
        <NumberStepper
          value={Math.round(cm)}
          onChange={onChange}
          min={50}
          max={250}
          step={1}
          unit="cm"
          ariaLabel="Height in centimeters"
        />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <NumberStepper
            value={ft}
            onChange={(v) => setFromImperial(v, inches)}
            min={1}
            max={8}
            step={1}
            unit="ft"
            ariaLabel="Height feet"
          />
          <NumberStepper
            value={inches}
            onChange={(v) => setFromImperial(ft, v)}
            min={0}
            max={11}
            step={1}
            unit="in"
            ariaLabel="Height inches"
          />
        </div>
      )}
    </div>
  );
}
