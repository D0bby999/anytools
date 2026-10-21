/**
 * A 6px bar filled to `value` with a tick at `threshold` and the number beside
 * it, how up would draw a meter (it puts every figure in text). The same
 * props as MasteryMeter, so a page can swap one for the other.
 */
export function ProgressBar({
  value,
  threshold,
  label,
  valueText,
}: {
  value: number;
  threshold?: number;
  label: string;
  /** The figure shown beside the bar; defaults to the percentage. */
  valueText?: string;
}) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const mark = threshold === undefined ? undefined : Math.round(Math.min(1, Math.max(0, threshold)) * 100);
  return (
    <div className="lp-progress-bar">
      <div
        className="lp-progress-bar-track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={valueText}
      >
        <div className="lp-progress-bar-fill" style={{ width: `${pct}%` }} />
        {mark !== undefined ? <div aria-hidden="true" className="lp-progress-bar-tick" style={{ left: `${mark}%` }} /> : null}
      </div>
      <span data-numeric aria-hidden="true">
        {valueText ?? `${pct}%`}
      </span>
    </div>
  );
}
