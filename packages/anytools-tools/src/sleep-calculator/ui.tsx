'use client';
import { CalculatorTemplate, Input, SegmentedControl, TableResult } from '@anytools/ui';
import { useState } from 'react';
import { type SleepMode, computeSleepTimes, parseTimeString } from './logic';

function fmtTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function SleepCalculatorUi() {
  const [mode, setMode] = useState<SleepMode>('wakeUp');
  const [time, setTime] = useState('07:00');

  const ref = new Date();
  const anchor = parseTimeString(time, ref);
  const cycleRows = computeSleepTimes(mode, anchor);
  const rows = cycleRows.map((r) => ({
    label: r.label,
    value: fmtTime(r.target),
    emphasis: r.emphasis,
  }));

  return (
    <CalculatorTemplate
      title="Sleep Calculator"
      description="90-minute REM cycles + 14 min to fall asleep."
      inputs={
        <>
          <SegmentedControl
            value={mode}
            onChange={setMode}
            options={[
              { value: 'wakeUp', label: 'I want to wake up at' },
              { value: 'goToBed', label: 'I plan to sleep at' },
            ]}
            label="Mode"
          />
          <div>
            <span className="block text-sm font-medium mb-1.5">
              {mode === 'wakeUp' ? 'Target wake-up time' : 'Bedtime'}
            </span>
            <Input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="h-11"
              aria-label="Time"
            />
          </div>
        </>
      }
      result={
        <TableResult
          title={mode === 'wakeUp' ? 'Suggested bedtimes' : 'Suggested wake-up times'}
          rows={rows}
        />
      }
      onReset={() => {
        setMode('wakeUp');
        setTime('07:00');
      }}
      disclaimer="Estimates. Individual sleep cycles range 70-120 min; sleep quality matters more than exact timing."
    />
  );
}
