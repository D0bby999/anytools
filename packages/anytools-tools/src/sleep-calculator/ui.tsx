'use client';
import {
  CalculatorTemplate,
  Input,
  SegmentedControl,
  TableResult,
  useLocalized,
  useToolLocale,
} from '@anytools/ui';
import { useState } from 'react';
import { CYCLE_MIN, type SleepMode, computeSleepTimes, parseTimeString } from './logic';
import { STRINGS } from './strings';

/** Cycle counts shown, in display order — mirrors the logic default so labels can be rebuilt here. */
const CYCLES = [6, 5, 4, 3];

export function SleepCalculatorUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [mode, setMode] = useState<SleepMode>('wakeUp');
  const [time, setTime] = useState('07:00');

  const fmtTime = (d: Date): string =>
    d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });

  const ref = new Date();
  const anchor = parseTimeString(time, ref);
  const cycleRows = computeSleepTimes(mode, anchor, CYCLES);
  // The logic layer labels rows in English ("5 cycles (7h 30m)"); rebuild the label per locale.
  const rows = cycleRows.map((r, i) => {
    const n = CYCLES[i] ?? 0;
    const sleepMinutes = n * CYCLE_MIN;
    const hours = Math.floor(sleepMinutes / 60);
    const mins = sleepMinutes % 60;
    const duration = `${hours}h${mins ? ` ${mins}m` : ''}`;
    return {
      label: s.cyclesLabel.replace('{n}', String(n)).replace('{time}', duration),
      value: fmtTime(r.target),
      emphasis: r.emphasis,
    };
  });

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            options={[
              { value: 'wakeUp', label: s.wakeUpAt },
              { value: 'goToBed', label: s.sleepAt },
            ]}
            label={s.mode}
          />
          <div>
            <span className="block text-sm font-medium mb-1.5">
              {mode === 'wakeUp' ? s.targetWakeTime : s.bedtime}
            </span>
            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="h-11"
              aria-label={s.timeAria}
            />
          </div>
        </>
      }
      result={
        <TableResult
          title={mode === 'wakeUp' ? s.suggestedBedtimes : s.suggestedWakeTimes}
          rows={rows}
        />
      }
      onReset={() => {
        setMode('wakeUp');
        setTime('07:00');
      }}
      disclaimer={s.disclaimer}
    />
  );
}
