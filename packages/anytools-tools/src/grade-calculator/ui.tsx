'use client';
import { CalculatorTemplate, NumericPrimary, RangeSlider } from '@anytools/ui';
import { useState } from 'react';
import { calcNeededScore } from './logic';

export function GradeCalculatorUi() {
  const [current, setCurrent] = useState(85);
  const [target, setTarget] = useState(90);
  const [finalWeight, setFinalWeight] = useState(30);

  const { needed, achievable } = calcNeededScore(current, target, finalWeight);

  return (
    <CalculatorTemplate
      title="Final Grade Calculator"
      description="What score do I need on the final to reach my target?"
      inputs={
        <>
          <RangeSlider
            value={current}
            onChange={setCurrent}
            min={0}
            max={100}
            step={1}
            label="Current grade"
            unit="%"
          />
          <RangeSlider
            value={target}
            onChange={setTarget}
            min={0}
            max={100}
            step={1}
            label="Target final grade"
            unit="%"
          />
          <RangeSlider
            value={finalWeight}
            onChange={setFinalWeight}
            min={5}
            max={70}
            step={5}
            label="Final exam weight"
            unit="%"
          />
        </>
      }
      result={
        <NumericPrimary
          label="Score needed on final"
          value={achievable ? needed.toFixed(1) : '—'}
          unit={achievable ? '%' : undefined}
          category={
            !achievable
              ? {
                  label: needed > 100 ? 'Not achievable' : 'Target already met',
                  tone: needed > 100 ? 'danger' : 'good',
                }
              : needed > 90
                ? { label: 'Tough', tone: 'warn' }
                : { label: 'Achievable', tone: 'good' }
          }
          caption={
            achievable
              ? `If you score ${needed.toFixed(1)}% on the final, you'll end with a ${target}% overall.`
              : needed > 100
                ? 'Even a perfect final cannot reach this target. Consider extra credit options.'
                : "You've already met or exceeded this target."
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
