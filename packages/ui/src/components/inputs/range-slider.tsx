'use client';

type Props = {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step?: number;
  label?: string;
  unit?: string;
  ariaLabel?: string;
  className?: string;
};

/**
 * Native range input styled mobile-first. Shows current value next to label.
 * Tap target enlarged via CSS pseudo. Respects prefers-reduced-motion.
 */
export function RangeSlider({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  unit,
  ariaLabel,
  className,
}: Props) {
  return (
    <div className={className}>
      {label && (
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-sm font-medium">{label}</span>
          <span className="text-sm tabular-nums font-medium text-muted-foreground">
            {value}
            {unit && <span className="ml-1 text-xs">{unit}</span>}
          </span>
        </div>
      )}
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        aria-label={ariaLabel ?? label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        className="w-full h-11 cursor-pointer accent-accent touch-manipulation"
      />
    </div>
  );
}
