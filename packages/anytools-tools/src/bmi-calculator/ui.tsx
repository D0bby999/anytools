'use client';
import { CalculatorTemplate, HeightInput, NumericPrimary, WeightInput } from '@anytools/ui';
import { useState } from 'react';
import { type BmiCategory, calculateBmi, categorize } from './logic';

const CATEGORY_LABEL: Record<BmiCategory, string> = {
  underweight: 'Underweight',
  normal: 'Normal',
  overweight: 'Overweight',
  'obese-1': 'Obesity class I',
  'obese-2': 'Obesity class II',
  'obese-3': 'Obesity class III',
};

const CATEGORY_TONE: Record<BmiCategory, 'good' | 'warn' | 'danger' | 'neutral'> = {
  underweight: 'warn',
  normal: 'good',
  overweight: 'warn',
  'obese-1': 'danger',
  'obese-2': 'danger',
  'obese-3': 'danger',
};

export function BmiCalculatorUi() {
  const [heightCm, setHeightCm] = useState(170);
  const [weightKg, setWeightKg] = useState(70);

  const bmi = calculateBmi(weightKg, heightCm);
  const category = categorize(bmi);

  return (
    <CalculatorTemplate
      title="BMI Calculator"
      description="Body Mass Index with WHO category. Metric or imperial."
      inputs={
        <>
          <HeightInput cm={heightCm} onChange={setHeightCm} />
          <WeightInput kg={weightKg} onChange={setWeightKg} />
        </>
      }
      result={
        <NumericPrimary
          label="Your BMI"
          value={bmi.toFixed(1)}
          unit="kg/m²"
          category={{ label: CATEGORY_LABEL[category], tone: CATEGORY_TONE[category] }}
          caption="WHO 1995 ranges. Asian-Pacific population may use 23 / 27.5 cutoffs."
        />
      }
      onReset={() => {
        setHeightCm(170);
        setWeightKg(70);
      }}
      disclaimer="For estimation only. BMI does not distinguish muscle from fat; athletes, pregnant people, children and the elderly need different assessment. Consult a clinician for medical decisions."
    />
  );
}
