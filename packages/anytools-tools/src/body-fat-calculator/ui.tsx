'use client';
import {
  CalculatorTemplate,
  HeightInput,
  NumberStepper,
  NumericPrimary,
  SegmentedControl,
  useLocalized,
  useToolLocale,
} from '@anytools/ui';
import { useState } from 'react';
import { type Sex, classifyBodyFat, usNavyBodyFat } from './logic';
import { STRINGS } from './strings';

export function BodyFatCalculatorUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [sex, setSex] = useState<Sex>('male');
  const [cm, setCm] = useState(170);
  const [waist, setWaist] = useState(85);
  const [neck, setNeck] = useState(38);
  const [hip, setHip] = useState(95);

  // classifyBodyFat labels its categories in English; map those names to the locale.
  const categoryLabel: Record<string, string> = {
    'Essential fat': s.cat_essential,
    Athletic: s.cat_athletic,
    Fitness: s.cat_fitness,
    Average: s.cat_average,
    High: s.cat_high,
  };

  const bf = usNavyBodyFat(sex, cm, waist, neck, sex === 'female' ? hip : 0);
  const validBf = bf !== null && Number.isFinite(bf) ? Math.max(0, Math.min(60, bf)) : null;
  const clamped = validBf ?? 0;
  const { label: category, tone } = classifyBodyFat(clamped, sex);

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
          <NumberStepper
            value={waist}
            onChange={setWaist}
            min={50}
            max={200}
            label={s.waist}
            unit="cm"
          />
          <NumberStepper
            value={neck}
            onChange={setNeck}
            min={20}
            max={60}
            label={s.neck}
            unit="cm"
          />
          {sex === 'female' && (
            <NumberStepper
              value={hip}
              onChange={setHip}
              min={60}
              max={200}
              label={s.hip}
              unit="cm"
            />
          )}
        </>
      }
      result={
        validBf === null ? (
          <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
            {s.outOfRange}
          </div>
        ) : (
          <NumericPrimary
            label={s.bodyFat}
            value={validBf.toLocaleString(locale, {
              minimumFractionDigits: 1,
              maximumFractionDigits: 1,
            })}
            unit="%"
            category={{ label: categoryLabel[category] ?? category, tone }}
            caption={s.caption}
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
      disclaimer={s.disclaimer}
    />
  );
}
