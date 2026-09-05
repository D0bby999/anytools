'use client';
import {
  CalculatorTemplate,
  Input,
  SegmentedControl,
  TableResult,
  useLocalized,
} from '@anytools/ui';
import { useState } from 'react';
import { RACES, calculatePace, formatPace, formatTime, toKm } from './logic';
import { STRINGS } from './strings';

type Unit = 'km' | 'mile';

export function PaceCalculatorUi() {
  const s = useLocalized(STRINGS);
  const [unit, setUnit] = useState<Unit>('km');
  const [distance, setDistance] = useState(10);
  const [minutes, setMinutes] = useState(50);
  const [seconds, setSeconds] = useState(0);

  // RACES names come from logic.ts in English; "5K"/"10K" are universal, the rest map here.
  const raceLabel: Record<string, string> = {
    'Half marathon': s.race_half,
    Marathon: s.race_marathon,
  };

  const totalSec = minutes * 60 + seconds;
  const distanceKm = toKm(distance, unit);
  const { paceSecPerKm, paceSecPerMile } = calculatePace(distanceKm, totalSec);

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <>
          <SegmentedControl
            value={unit}
            onChange={setUnit}
            options={[
              { value: 'km', label: s.kilometers },
              { value: 'mile', label: s.miles },
            ]}
            label={s.distanceUnit}
          />
          <div>
            <span className="block text-sm font-medium mb-1.5">{s.distance}</span>
            <Input
              type="number"
              inputMode="decimal"
              value={distance}
              onChange={(e) => setDistance(e.target.valueAsNumber || 0)}
              className="h-11 tabular-nums"
              aria-label={s.distance}
              min={0.1}
              step={0.1}
            />
          </div>
          <div>
            <span className="block text-sm font-medium mb-1.5">{s.time}</span>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Input
                  type="number"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.valueAsNumber || 0)}
                  className="h-11 tabular-nums"
                  aria-label={s.minutes}
                  min={0}
                />
                <p className="text-xs text-muted-foreground mt-1 text-center">{s.minutesHint}</p>
              </div>
              <div>
                <Input
                  type="number"
                  value={seconds}
                  onChange={(e) => setSeconds(e.target.valueAsNumber || 0)}
                  className="h-11 tabular-nums"
                  aria-label={s.seconds}
                  min={0}
                  max={59}
                />
                <p className="text-xs text-muted-foreground mt-1 text-center">{s.secondsHint}</p>
              </div>
            </div>
          </div>
        </>
      }
      result={
        <TableResult
          title={s.tableTitle}
          rows={[
            { label: s.pacePerKm, value: `${formatPace(paceSecPerKm)} /km`, emphasis: true },
            { label: s.pacePerMile, value: `${formatPace(paceSecPerMile)} /mi`, emphasis: true },
            ...RACES.map((r) => ({
              label: raceLabel[r.name] ?? r.name,
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
