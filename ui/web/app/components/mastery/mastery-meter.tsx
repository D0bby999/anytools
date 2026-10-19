/**
 * How far a module is, against where it passes: a bar filled to the mastery
 * estimate with a mark at the pass threshold. "44% · needs 70%" in a line of
 * small text was the whole picture before; three modules side by side are read
 * at a glance only as lengths.
 *
 * The fill is the part's colour (Practise), the mark the ink. The numbers stay
 * in the text beside it; the bar is a reading aid, not the only statement.
 */
export function MasteryMeter({ value, threshold, label }: { value: number; threshold: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const mark = Math.round(Math.min(1, Math.max(0, threshold)) * 100);
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="relative mt-2 h-2 rounded-full bg-sunken"
    >
      <div className="h-full rounded-full bg-part" style={{ width: `${pct}%` }} />
      <div aria-hidden="true" className="absolute -top-1 h-4 w-0.5 rounded-full bg-foreground" style={{ left: `${mark}%` }} />
    </div>
  );
}
