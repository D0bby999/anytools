'use client';
import {
  CalculatorTemplate,
  HeightInput,
  NumericPrimary,
  WeightInput,
  useLocalized,
  useToolLocale,
} from '@anytools/ui';
import { useState } from 'react';
import { type BmiCategory, calculateBmi, categorize } from './logic';
import { STRINGS } from './strings';

const CATEGORY_TONE: Record<BmiCategory, 'good' | 'warn' | 'danger' | 'neutral'> = {
  underweight: 'warn',
  normal: 'good',
  overweight: 'warn',
  'obese-1': 'danger',
  'obese-2': 'danger',
  'obese-3': 'danger',
};

export function BmiCalculatorUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [heightCm, setHeightCm] = useState(170);
  const [weightKg, setWeightKg] = useState(70);

  // The logic layer names categories by id; the label is picked per locale here.
  const categoryLabel: Record<BmiCategory, string> = {
    underweight: s.cat_underweight,
    normal: s.cat_normal,
    overweight: s.cat_overweight,
    'obese-1': s.cat_obese1,
    'obese-2': s.cat_obese2,
    'obese-3': s.cat_obese3,
  };

  const bmi = calculateBmi(weightKg, heightCm);
  const category = categorize(bmi);

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <>
          <HeightInput cm={heightCm} onChange={setHeightCm} />
          <WeightInput kg={weightKg} onChange={setWeightKg} />
        </>
      }
      result={
        <NumericPrimary
          label={s.yourBmi}
          value={bmi.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
          unit="kg/m²"
          category={{ label: categoryLabel[category], tone: CATEGORY_TONE[category] }}
          caption={s.caption}
        />
      }
      onReset={() => {
        setHeightCm(170);
        setWeightKg(70);
      }}
      disclaimer={s.disclaimer}
    />
  );
}
