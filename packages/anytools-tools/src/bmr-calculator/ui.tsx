'use client';
import {
  CalculatorTemplate,
  HeightInput,
  NumberStepper,
  NumericPrimary,
  SegmentedControl,
  WeightInput,
  useLocalized,
  useToolLocale,
} from '@anytools/ui';
import { useState } from 'react';
import { type Sex, mifflinStJeor } from './logic';
import { STRINGS } from './strings';

export function BmrCalculatorUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [kg, setKg] = useState(70);
  const [cm, setCm] = useState(170);
  const [age, setAge] = useState(30);
  const [sex, setSex] = useState<Sex>('male');

  const bmr = mifflinStJeor(kg, cm, age, sex);

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <>
          <SegmentedControl
            value={sex}
            onChange={setSex}
            options={[
              { value: 'male', label: s.male },
              { value: 'female', label: s.female },
            ]}
            label={s.sexLabel}
          />
          <HeightInput cm={cm} onChange={setCm} />
          <WeightInput kg={kg} onChange={setKg} />
          <NumberStepper
            value={age}
            onChange={setAge}
            min={10}
            max={120}
            label={s.age}
            unit={s.unitYears}
          />
        </>
      }
      result={
        <NumericPrimary
          label={s.yourBmr}
          value={Math.round(bmr).toLocaleString(locale)}
          unit={s.unitKcalDay}
          caption={s.caption}
        />
      }
      onReset={() => {
        setKg(70);
        setCm(170);
        setAge(30);
        setSex('male');
      }}
      disclaimer={s.disclaimer}
    />
  );
}
