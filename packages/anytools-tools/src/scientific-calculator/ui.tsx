'use client';
import { Button, Input } from '@anytools/ui';
import { useState } from 'react';
import { evaluateExpression, formatResult } from './logic';

const KEYS = [
  ['7', '8', '9', '/', 'sin('],
  ['4', '5', '6', '*', 'cos('],
  ['1', '2', '3', '-', 'tan('],
  ['0', '.', '(', '+', 'log('],
  ['pi', 'e', ')', '^', 'sqrt('],
];

export function ScientificCalculatorUi() {
  const [expr, setExpr] = useState('');
  const result = evaluateExpression(expr);

  const tap = (k: string) => setExpr((e) => e + k);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold mb-1">Scientific Calculator</h2>
        <p className="text-sm text-muted-foreground">
          Functions: sin, cos, tan, asin, acos, atan, log (base 10), ln, sqrt, exp, abs, !, ^.
          Constants: pi, e.
        </p>
      </header>
      <div>
        <Input
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          placeholder="e.g. sin(pi/4) + sqrt(16)"
          className="h-14 text-xl font-mono"
          aria-label="Expression"
        />
        <div className="mt-2 rounded-md border bg-card p-4 text-right text-2xl font-bold tabular-nums">
          {formatResult(result)}
        </div>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {KEYS.flat().map((k) => (
          <Button
            key={k}
            type="button"
            variant="outline"
            onClick={() => tap(k)}
            className="h-12 font-mono"
          >
            {k}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => setExpr((e) => e.slice(0, -1))}
          className="h-12 col-span-2"
        >
          ←
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setExpr('')}
          className="h-12 col-span-3"
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
