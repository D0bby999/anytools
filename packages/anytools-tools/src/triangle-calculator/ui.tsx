'use client';
import { CalculatorTemplate, Input, TableResult } from '@anytools/ui';
import { useState } from 'react';
import { solveSSS } from './logic';

export function TriangleCalculatorUi() {
  const [a, setA] = useState(3);
  const [b, setB] = useState(4);
  const [c, setC] = useState(5);

  const result = solveSSS(a, b, c);
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });

  return (
    <CalculatorTemplate
      title="Triangle Calculator"
      description="Three sides → angles, area, perimeter. Heron's formula."
      inputs={
        <>
          <div>
            <span className="block text-sm font-medium mb-1.5">Side a</span>
            <Input
              type="number"
              value={a}
              onChange={(e) => setA(e.target.valueAsNumber || 0)}
              className="h-11 tabular-nums"
              min={0.001}
              step={0.1}
              aria-label="Side a"
            />
          </div>
          <div>
            <span className="block text-sm font-medium mb-1.5">Side b</span>
            <Input
              type="number"
              value={b}
              onChange={(e) => setB(e.target.valueAsNumber || 0)}
              className="h-11 tabular-nums"
              min={0.001}
              step={0.1}
              aria-label="Side b"
            />
          </div>
          <div>
            <span className="block text-sm font-medium mb-1.5">Side c</span>
            <Input
              type="number"
              value={c}
              onChange={(e) => setC(e.target.valueAsNumber || 0)}
              className="h-11 tabular-nums"
              min={0.001}
              step={0.1}
              aria-label="Side c"
            />
          </div>
        </>
      }
      result={
        result ? (
          <TableResult
            rows={[
              { label: 'Area', value: fmt(result.area), emphasis: true },
              { label: 'Perimeter', value: fmt(result.perimeter) },
              { label: 'Angle A', value: `${fmt(result.angleA)}°` },
              { label: 'Angle B', value: `${fmt(result.angleB)}°` },
              { label: 'Angle C', value: `${fmt(result.angleC)}°` },
              { label: 'Type', value: result.isRight ? 'Right triangle' : 'Oblique' },
            ]}
          />
        ) : (
          <div className="rounded-lg border border-dashed bg-card p-6 text-center text-sm text-muted-foreground">
            Sides violate triangle inequality.
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
