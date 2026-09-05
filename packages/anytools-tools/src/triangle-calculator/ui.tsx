'use client';
import { CalculatorTemplate, Input, TableResult, useLocalized, useToolLocale } from '@anytools/ui';
import { useState } from 'react';
import { solveSSS } from './logic';
import { STRINGS } from './strings';

export function TriangleCalculatorUi() {
  const s = useLocalized(STRINGS);
  const locale = useToolLocale();
  const [a, setA] = useState(3);
  const [b, setB] = useState(4);
  const [c, setC] = useState(5);

  const result = solveSSS(a, b, c);
  const fmt = (n: number) => n.toLocaleString(locale, { maximumFractionDigits: 3 });

  return (
    <CalculatorTemplate
      title={s.title}
      description={s.description}
      inputs={
        <>
          <div>
            <span className="block text-sm font-medium mb-1.5">{s.sideA}</span>
            <Input
              type="number"
              value={a}
              onChange={(e) => setA(e.target.valueAsNumber || 0)}
              className="h-11 tabular-nums"
              min={0.001}
              step={0.1}
              aria-label={s.sideA}
            />
          </div>
          <div>
            <span className="block text-sm font-medium mb-1.5">{s.sideB}</span>
            <Input
              type="number"
              value={b}
              onChange={(e) => setB(e.target.valueAsNumber || 0)}
              className="h-11 tabular-nums"
              min={0.001}
              step={0.1}
              aria-label={s.sideB}
            />
          </div>
          <div>
            <span className="block text-sm font-medium mb-1.5">{s.sideC}</span>
            <Input
              type="number"
              value={c}
              onChange={(e) => setC(e.target.valueAsNumber || 0)}
              className="h-11 tabular-nums"
              min={0.001}
              step={0.1}
              aria-label={s.sideC}
            />
          </div>
        </>
      }
      result={
        result ? (
          <TableResult
            rows={[
              { label: s.area, value: fmt(result.area), emphasis: true },
              { label: s.perimeter, value: fmt(result.perimeter) },
              { label: s.angleA, value: `${fmt(result.angleA)}°` },
              { label: s.angleB, value: `${fmt(result.angleB)}°` },
              { label: s.angleC, value: `${fmt(result.angleC)}°` },
              { label: s.type, value: result.isRight ? s.rightTriangle : s.oblique },
            ]}
          />
        ) : (
          <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
            {s.invalid}
          </div>
        )
      }
      onReset={() => {
        setA(3);
        setB(4);
        setC(5);
      }}
    />
  );
}
