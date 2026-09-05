'use client';
import { CurrencyInput, Input, TableResult, useLocalized } from '@anytools/ui';
import { useState } from 'react';
import { type TimeCardDay, dayHours, summariseWeek } from './logic';
import { STRINGS } from './strings';

type Day = TimeCardDay;

// `label` doubles as the row key; the name shown comes from the strings table (`day_<label>`).
const DEFAULT_DAYS: Day[] = [
  { label: 'Monday', in: '09:00', out: '17:00', break: 30 },
  { label: 'Tuesday', in: '09:00', out: '17:00', break: 30 },
  { label: 'Wednesday', in: '09:00', out: '17:00', break: 30 },
  { label: 'Thursday', in: '09:00', out: '17:00', break: 30 },
  { label: 'Friday', in: '09:00', out: '17:00', break: 30 },
  { label: 'Saturday', in: '', out: '', break: 0 },
  { label: 'Sunday', in: '', out: '', break: 0 },
];

export function TimeCardCalculatorUi() {
  const s = useLocalized(STRINGS);
  const [days, setDays] = useState<Day[]>(DEFAULT_DAYS);
  const [rate, setRate] = useState(20);

  const {
    totalHours: total,
    regularHours: regular,
    overtimeHours: overtime,
    grossPay: pay,
  } = summariseWeek(days, rate);

  const update = (i: number, patch: Partial<Day>) =>
    setDays((ds) => ds.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  const dayName = (d: Day) => (s as Record<string, string>)[`day_${d.label}`] ?? d.label;
  const hoursAt = (h: number, r: number) =>
    s.hoursAtRate.replace('{h}', h.toFixed(2)).replace('{rate}', String(r));

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold mb-1">{s.title}</h2>
        <p className="text-sm text-muted-foreground">{s.description}</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-2">
          {days.map((d, i) => (
            <div key={d.label} className="grid grid-cols-12 gap-2 items-center">
              <div className="col-span-3 text-sm font-medium">{dayName(d)}</div>
              <Input
                type="time"
                value={d.in}
                onChange={(e) => update(i, { in: e.target.value })}
                className="col-span-3 h-11"
                aria-label={s.dayIn.replace('{day}', dayName(d))}
              />
              <Input
                type="time"
                value={d.out}
                onChange={(e) => update(i, { out: e.target.value })}
                className="col-span-3 h-11"
                aria-label={s.dayOut.replace('{day}', dayName(d))}
              />
              <Input
                type="number"
                value={d.break}
                min={0}
                max={240}
                onChange={(e) => update(i, { break: e.target.valueAsNumber || 0 })}
                className="col-span-2 h-11 tabular-nums"
                aria-label={s.dayBreak.replace('{day}', dayName(d))}
              />
              <div className="col-span-1 text-sm tabular-nums text-right text-muted-foreground">
                {dayHours(d).toFixed(1)}
              </div>
            </div>
          ))}
        </div>
        <div className="lg:col-span-2 space-y-4 lg:sticky lg:top-20 lg:self-start">
          <CurrencyInput value={rate} onChange={setRate} label={s.hourlyRate} />
          <TableResult
            rows={[
              { label: s.totalHours, value: `${total.toFixed(2)} h`, emphasis: true },
              { label: s.regular, value: hoursAt(regular, rate) },
              { label: s.overtime, value: hoursAt(overtime, Number((rate * 1.5).toFixed(2))) },
              { label: s.pay, value: `$${pay.toFixed(2)}`, emphasis: true },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
