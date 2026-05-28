'use client';
import { Minus, Plus } from 'lucide-react';
import { Button } from '../button';
import { Input } from '../input';

type Props = {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  ariaLabel?: string;
  unit?: string;
  className?: string;
};

/**
 * Mobile-first number input with +/- steppers. Min 44×44 touch targets.
 * Keyboard: ArrowUp/Down adjust by step, typing parses on blur.
 */
export function NumberStepper({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 1,
  label,
  ariaLabel,
  unit,
  className,
}: Props) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const dec = () => onChange(clamp(value - step));
  const inc = () => onChange(clamp(value + step));

  return (
    <div className={className}>
      {label && <span className="block text-sm font-medium mb-1.5">{label}</span>}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={dec}
          disabled={value <= min}
          aria-label={`Decrease ${ariaLabel ?? label ?? 'value'}`}
          className="h-11 w-11 shrink-0"
        >
          <Minus className="h-4 w-4" />
        </Button>
        <Input
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            if (Number.isFinite(n)) onChange(clamp(n));
          }}
          aria-label={ariaLabel ?? label}
          className="h-11 text-center text-base font-medium tabular-nums"
        />
        {unit && (
          <span className="text-sm font-medium text-muted-foreground shrink-0 w-10">{unit}</span>
        )}
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={inc}
          disabled={value >= max}
          aria-label={`Increase ${ariaLabel ?? label ?? 'value'}`}
          className="h-11 w-11 shrink-0"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
