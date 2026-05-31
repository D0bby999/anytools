'use client';
import {
  CalculatorTemplate,
  HeightInput,
  NumberStepper,
  NumericPrimary,
  SegmentedControl,
  WeightInput,
} from '@anytools/ui';
import { useState } from 'react';
import { mifflinStJeor, type Sex } from './logic';

export function BmrCalculatorUi() {
  const [kg, setKg] = useState(70);
  const [cm, setCm] = useState(170);
  const [age, setAge] = useState(30);
  const [sex, setSex] = useState<Sex>('male');

  const bmr = mifflinStJeor(kg, cm, age, sex);

  return (
    <CalculatorTemplate
      title="BMR Calculator"
      description="Mifflin–St Jeor — calories burned at rest."
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
          <WeightInput kg={kg} onChange={setKg} />
          <NumberStepper value={age} onChange={setAge} min={10} max={120} label="Age" unit="yrs" />
        </>
      }
      result={
        <NumericPrimary
          label="Your BMR"
          value={Math.round(bmr).toLocaleString()}
          unit="kcal/day"
          caption="Calories your body burns at complete rest. Multiply by activity factor for TDEE."
        />
      }
      onReset={() => {
        setKg(70);
        setCm(170);
        setAge(30);
        setSex('male');
      }}
      disclaimer="Estimation only. ±10% accuracy. Real metabolic rates vary with thyroid status, body composition, and recent diet."
    />
  );
}
