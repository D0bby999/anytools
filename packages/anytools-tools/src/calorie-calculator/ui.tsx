'use client';
import {
  CalculatorTemplate,
  HeightInput,
  NumberStepper,
  SegmentedControl,
  TableResult,
  WeightInput,
} from '@anytools/ui';
import { useState } from 'react';
import {
  ACTIVITY_FACTOR,
  ACTIVITY_LABEL,
  calculateCalories,
  type Activity,
  type Sex,
} from './logic';

export function CalorieCalculatorUi() {
  const [kg, setKg] = useState(70);
  const [cm, setCm] = useState(170);
  const [age, setAge] = useState(30);
  const [sex, setSex] = useState<Sex>('male');
  const [activity, setActivity] = useState<Activity>('moderate');

  const { bmr: bmrVal, tdee } = calculateCalories(kg, cm, age, sex, activity);

  const r = (n: number) => Math.round(n).toLocaleString();

  return (
    <CalculatorTemplate
      title="Calorie & TDEE Calculator"
      description="BMR × activity factor × goal adjustment."
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
          <div>
            <span className="block text-sm font-medium mb-1.5">Activity level</span>
            <select
              value={activity}
              onChange={(e) => setActivity(e.target.value as Activity)}
              className="w-full h-11 rounded-md border bg-background px-3 text-sm"
            >
              {(Object.keys(ACTIVITY_FACTOR) as Activity[]).map((a) => (
                <option key={a} value={a}>
                  {ACTIVITY_LABEL[a]}
                </option>
              ))}
            </select>
          </div>
        </>
      }
      result={
        <TableResult
          title="Daily Calorie Targets"
          rows={[
            { label: 'BMR (rest)', value: `${r(bmrVal)} kcal` },
            { label: 'Maintenance (TDEE)', value: `${r(tdee)} kcal`, emphasis: true },
            { label: 'Mild weight loss (-250)', value: `${r(tdee - 250)} kcal` },
            { label: 'Weight loss (-500)', value: `${r(tdee - 500)} kcal` },
            { label: 'Mild weight gain (+250)', value: `${r(tdee + 250)} kcal` },
            { label: 'Weight gain (+500)', value: `${r(tdee + 500)} kcal` },
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
      disclaimer="Estimation only. Real metabolic rates vary ±10%. Sustained large deficits (>500 cal/day) trigger metabolic adaptation; bodies push back."
    />
  );
}
