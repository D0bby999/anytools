type BarRow = { label: string; value: number; accent?: 'primary' | 'good' | 'warn' | 'danger' };

type Props = {
  title?: string;
  rows: BarRow[];
  formatValue?: (n: number) => string;
  className?: string;
};

const ACCENT_BG = {
  primary: 'bg-accent',
  good: 'bg-success',
  warn: 'bg-warning',
  danger: 'bg-destructive',
};

/**
 * Pure-CSS horizontal bar chart. No chart library. Each bar scales to the
 * max value. Used for: macro breakdown (carbs/protein/fat),
 * amortization principal-vs-interest, year-by-year compound growth previews.
 */
export function ChartFallback({ title, rows, formatValue, className }: Props) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  const fmt = formatValue ?? ((n: number) => String(n));

  return (
    <div className={`rounded-lg border bg-card p-4 ${className ?? ''}`}>
      {title && (
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">
          {title}
        </p>
      )}
      <div className="space-y-3">
        {rows.map((row, i) => {
          const pct = (row.value / max) * 100;
          return (
            <div key={`${row.label}-${i}`}>
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-sm font-medium">{row.label}</span>
                <span className="text-sm tabular-nums text-muted-foreground">{fmt(row.value)}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden" aria-hidden="true">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    ACCENT_BG[row.accent ?? 'primary']
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
