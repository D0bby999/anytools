import type { ReactNode } from 'react';

type Row = {
  label: string;
  value: ReactNode;
  emphasis?: boolean;
};

type Props = {
  title?: string;
  rows: Row[];
  className?: string;
};

/**
 * Compact key/value table. Used by tip calculator (Subtotal/Tip/Total),
 * amortization rows, BMR breakdown, etc.
 */
export function TableResult({ title, rows, className }: Props) {
  return (
    <div className={`rounded-lg border bg-card overflow-hidden ${className ?? ''}`}>
      {title && (
        <div className="border-b px-4 py-2.5 bg-muted/50">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </p>
        </div>
      )}
      <dl className="divide-y">
        {rows.map((row, i) => (
          <div
            key={`${row.label}-${i}`}
            className={`flex items-baseline justify-between px-4 py-3 ${
              row.emphasis ? 'bg-accent/5 font-semibold' : ''
            }`}
          >
            <dt className="text-sm text-muted-foreground">{row.label}</dt>
            <dd className="text-sm tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
