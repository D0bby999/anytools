'use client';
import {
  CalculatorTemplate,
  HeightInput,
  NumberStepper,
  SegmentedControl,
  TableResult,
  WeightInput,
  useLocalized,
  useToolLocale,
} from '@anytools/ui';
import { useState } from 'react';
import {
  ACTIVITY_FACTOR,
  ACTIVITY_LABEL,
  type Activity,
  type Sex,
  calculateCalories,
} from './logic';
import { STRINGS } from './strings';

export function CalorieCalculatorUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [kg, setKg] = useState(70);
  const [cm, setCm] = useState(170);
  const [age, setAge] = useState(30);
  const [sex, setSex] = useState<Sex>('male');
  const [activity, setActivity] = useState<Activity>('moderate');

  // ACTIVITY_LABEL in logic.ts is English; pick the label per locale by id.
  const activityLabel: Record<Activity, string> = {
    sedentary: s.activity_sedentary,
    light: s.activity_light,
    moderate: s.activity_moderate,
    active: s.activity_active,
    athlete: s.activity_athlete,
  };

  const { bmr: bmrVal, tdee } = calculateCalories(kg, cm, age, sex, activity);

  const r = (n: number) => Math.round(n).toLocaleString(locale);

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
          <div>
            <span className="block text-sm font-medium mb-1.5">{s.activityLevel}</span>
            <select
              value={activity}
              onChange={(e) => setActivity(e.target.value as Activity)}
              className="w-full h-11 rounded-md border bg-background px-3 text-sm"
              aria-label={s.activityLevel}
            >
              {(Object.keys(ACTIVITY_FACTOR) as Activity[]).map((a) => (
                <option key={a} value={a}>
                  {activityLabel[a] ?? ACTIVITY_LABEL[a]}
                </option>
              ))}
            </select>
          </div>
        </>
      }
      result={
        <TableResult
          title={s.tableTitle}
          rows={[
            { label: s.row_bmr, value: `${r(bmrVal)} kcal` },
            { label: s.row_tdee, value: `${r(tdee)} kcal`, emphasis: true },
            { label: s.row_mildLoss, value: `${r(tdee - 250)} kcal` },
            { label: s.row_loss, value: `${r(tdee - 500)} kcal` },
            { label: s.row_mildGain, value: `${r(tdee + 250)} kcal` },
            { label: s.row_gain, value: `${r(tdee + 500)} kcal` },
          ]}
        />
      }
      onReset={() => {
        setKg(70);
        setCm(170);
        setAge(30);
        setSex('male');
        setActivity('moderate');
      }}
      disclaimer={s.disclaimer}
    />
  );
}
