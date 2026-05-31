'use client';
import { CalculatorTemplate, Input, SegmentedControl, TableResult } from '@anytools/ui';
import { useState } from 'react';
import { RACES, calculatePace, formatPace, formatTime, toKm } from './logic';

type Unit = 'km' | 'mile';

export function PaceCalculatorUi() {
  const [unit, setUnit] = useState<Unit>('km');
  const [distance, setDistance] = useState(10);
  const [minutes, setMinutes] = useState(50);
  const [seconds, setSeconds] = useState(0);

  const totalSec = minutes * 60 + seconds;
  const distanceKm = toKm(distance, unit);
  const { paceSecPerKm, paceSecPerMile } = calculatePace(distanceKm, totalSec);

  return (
    <CalculatorTemplate
      title="Running Pace Calculator"
      description="Pace from distance + time. Race-distance projections."
      inputs={
        <>
          <SegmentedControl
            value={unit}
            onChange={setUnit}
            options={[
              { value: 'km', label: 'Kilometers' },
              { value: 'mile', label: 'Miles' },
            ]}
            label="Distance unit"
          />
          <div>
            <span className="block text-sm font-medium mb-1.5">Distance</span>
            <Input
              type="number"
              inputMode="decimal"
              value={distance}
              onChange={(e) => setDistance(e.target.valueAsNumber || 0)}
              className="h-11 tabular-nums"
              aria-label="Distance"
              min={0.1}
              step={0.1}
            />
          </div>
          <div>
            <span className="block text-sm font-medium mb-1.5">Time</span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Input
                  type="number"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.valueAsNumber || 0)}
                  className="h-11 tabular-nums"
                  aria-label="Minutes"
                  min={0}
                />
                <p className="text-xs text-muted-foreground mt-1 text-center">minutes</p>
              </div>
              <div>
                <Input
                  type="number"
                  value={seconds}
                  onChange={(e) => setSeconds(e.target.valueAsNumber || 0)}
                  className="h-11 tabular-nums"
                  aria-label="Seconds"
                  min={0}
                  max={59}
                />
                <p className="text-xs text-muted-foreground mt-1 text-center">seconds</p>
              </div>
            </div>
          </div>
        </>
      }
      result={
        <TableResult
          title="Pace + race projections"
          rows={[
            { label: 'Pace per km', value: `${formatPace(paceSecPerKm)} /km`, emphasis: true },
            { label: 'Pace per mile', value: `${formatPace(paceSecPerMile)} /mi`, emphasis: true },
            ...RACES.map((r) => ({
              label: r.name,
              value: formatTime(r.km * paceSecPerKm),
            })),
          ]}
        />
      }
      onReset={() => {
        setUnit('km');
        setDistance(10);
        setMinutes(50);
        setSeconds(0);
      }}
    />
  );
}
