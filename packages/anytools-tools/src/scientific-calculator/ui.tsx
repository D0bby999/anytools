'use client';
import { Button, Input, useLocalized, useUiStrings } from '@anytools/ui';
import { useState } from 'react';
import { evaluateExpression, formatResult } from './logic';
import { STRINGS } from './strings';

const KEYS = [
  ['7', '8', '9', '/', 'sin('],
  ['4', '5', '6', '*', 'cos('],
  ['1', '2', '3', '-', 'tan('],
  ['0', '.', '(', '+', 'log('],
  ['pi', 'e', ')', '^', 'sqrt('],
];

export function ScientificCalculatorUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  const [expr, setExpr] = useState('');
  const result = evaluateExpression(expr);

  // The evaluator reports failures as English strings ('Error', 'Syntax error') and formatResult
  // renders a non-finite number as 'Error'; both are mapped to the locale here.
  const shown =
    result === 'Syntax error'
      ? s.syntaxError
      : result === 'Error' || (typeof result === 'number' && !Number.isFinite(result))
        ? s.error
        : formatResult(result);

  const tap = (k: string) => setExpr((e) => e + k);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-semibold mb-1">{s.title}</h2>
        <p className="text-sm text-muted-foreground">{s.description}</p>
      </header>
      <div>
        <Input
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          placeholder={s.placeholder}
          className="h-14 text-xl font-mono"
          aria-label={s.expression}
        />
        <div className="mt-2 rounded-md border bg-card p-4 text-right text-2xl font-bold tabular-nums">
          {shown}
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
          aria-label={s.backspace}
        >
          ←
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setExpr('')}
          className="h-12 col-span-3"
        >
          {ui.clear}
        </Button>
      </div>
    </div>
  );
}
