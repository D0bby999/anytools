'use client';
import { CalculatorTemplate, NumericPrimary, RangeSlider, useLocalized } from '@anytools/ui';
import { useState } from 'react';
import { calcNeededScore } from './logic';
import { STRINGS } from './strings';

export function GradeCalculatorUi() {
  const s = useLocalized(STRINGS);
  const [current, setCurrent] = useState(85);
  const [target, setTarget] = useState(90);
  const [finalWeight, setFinalWeight] = useState(30);

  const { needed, achievable } = calcNeededScore(current, target, finalWeight);

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <>
          <RangeSlider
            value={current}
            onChange={setCurrent}
            min={0}
            max={100}
            step={1}
            label={s.currentGrade}
            unit="%"
          />
          <RangeSlider
            value={target}
            onChange={setTarget}
            min={0}
            max={100}
            step={1}
            label={s.targetGrade}
            unit="%"
          />
          <RangeSlider
            value={finalWeight}
            onChange={setFinalWeight}
            min={5}
            max={70}
            step={5}
            label={s.finalWeight}
            unit="%"
          />
        </>
      }
      result={
        <NumericPrimary
          label={s.scoreNeeded}
          value={achievable ? needed.toFixed(1) : '—'}
          unit={achievable ? '%' : undefined}
          category={
            !achievable
              ? {
                  label: needed > 100 ? s.notAchievable : s.targetMet,
                  tone: needed > 100 ? 'danger' : 'good',
                }
              : needed > 90
                ? { label: s.tough, tone: 'warn' }
                : { label: s.achievable, tone: 'good' }
          }
          caption={
            achievable
              ? s.captionAchievable
                  .replace('{needed}', needed.toFixed(1))
                  .replace('{target}', String(target))
              : needed > 100
                ? s.captionImpossible
                : s.captionMet
          }
        />
      }
      onReset={() => {
        setCurrent(85);
        setTarget(90);
        setFinalWeight(30);
      }}
    />
  );
}
