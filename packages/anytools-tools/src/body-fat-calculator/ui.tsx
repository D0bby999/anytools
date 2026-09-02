'use client';
import {
  CalculatorTemplate,
  HeightInput,
  NumberStepper,
  NumericPrimary,
  SegmentedControl,
} from '@anytools/ui';
import { useState } from 'react';
import { type Sex, classifyBodyFat, usNavyBodyFat } from './logic';

export function BodyFatCalculatorUi() {
  const [sex, setSex] = useState<Sex>('male');
  const [cm, setCm] = useState(170);
  const [waist, setWaist] = useState(85);
  const [neck, setNeck] = useState(38);
  const [hip, setHip] = useState(95);

  const bf = usNavyBodyFat(sex, cm, waist, neck, sex === 'female' ? hip : 0);
  const validBf = bf !== null && Number.isFinite(bf) ? Math.max(0, Math.min(60, bf)) : null;
  const clamped = validBf ?? 0;
  const { label: category, tone } = classifyBodyFat(clamped, sex);

  return (
    <CalculatorTemplate
      title="Body Fat % Calculator"
      description="US Navy method (Hodgdon-Beckett). Estimate without calipers or DEXA."
      inputs={
        <>
          <SegmentedControl
            value={sex}
            onChange={setSex}
            options={[
              { value: 'male', label: 'Male' },
              { value: 'female', label: 'Female' },
            ]}
            label="Sex (biological)"
          />
          <HeightInput cm={cm} onChange={setCm} />
          <NumberStepper
            value={waist}
            onChange={setWaist}
            min={50}
            max={200}
            label="Waist"
            unit="cm"
          />
          <NumberStepper value={neck} onChange={setNeck} min={20} max={60} label="Neck" unit="cm" />
          {sex === 'female' && (
            <NumberStepper value={hip} onChange={setHip} min={60} max={200} label="Hip" unit="cm" />
          )}
        </>
      }
      result={
        validBf === null ? (
          <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
            Inputs out of range. Waist must be larger than neck.
          </div>
        ) : (
          <NumericPrimary
            label="Body fat"
            value={validBf.toFixed(1)}
            unit="%"
            category={{ label: category, tone }}
            caption="US Navy method has ±3-4% accuracy vs DEXA. Best for trend tracking, not single-point precision."
          />
        )
      }
      onReset={() => {
        setSex('male');
        setCm(170);
        setWaist(85);
        setNeck(38);
        setHip(95);
      }}
      disclaimer="Estimation only. For accurate body composition use DEXA, BodPod, or calibrated calipers."
    />
  );
}
