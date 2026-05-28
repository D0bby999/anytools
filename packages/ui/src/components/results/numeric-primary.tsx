import type { ReactNode } from 'react';

type Props = {
  value: string | number;
  unit?: string;
  label?: string;
  category?: { label: string; tone?: 'good' | 'warn' | 'danger' | 'neutral' };
  caption?: ReactNode;
  className?: string;
};

const TONE_CLASS = {
  good: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  danger: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  neutral: 'bg-muted text-muted-foreground',
};

/**
 * Big number + unit display. Used by calculators (BMI: "23.4 / Normal", etc.)
 */
export function NumericPrimary({ value, unit, label, category, caption, className }: Props) {
  return (
    <div className={`rounded-lg border bg-card p-6 text-center ${className ?? ''}`}>
      {label && (
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
          {label}
        </p>
      )}
      <div className="flex items-baseline justify-center gap-2 tabular-nums">
        <span className="text-5xl md:text-6xl font-bold leading-none">{value}</span>
        {unit && <span className="text-xl font-medium text-muted-foreground">{unit}</span>}
      </div>
      {category && (
        <div
          className={`inline-block mt-3 rounded-full px-3 py-1 text-xs font-medium ${
            TONE_CLASS[category.tone ?? 'neutral']
          }`}
        >
          {category.label}
        </div>
      )}
      {caption && <div className="text-sm text-muted-foreground mt-3">{caption}</div>}
    </div>
  );
}
