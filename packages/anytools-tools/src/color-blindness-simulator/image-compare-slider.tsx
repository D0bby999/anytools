'use client';
import { RangeSlider, useLocalized } from '@anytools/ui';
import { STRINGS } from './strings';

type Props = {
  originalUrl: string;
  simulatedUrl: string;
  splitPercent: number;
  onSplitChange: (next: number) => void;
  aspectRatio: number;
};

/**
 * Before/after slider. The simulated image fills the box; the original sits on top, clipped to
 * its own left `splitPercent`% — so dragging the handle right reveals more of the original
 * (matching how most before/after sliders read), and the simulated image shows through on the
 * right the rest of the way.
 */
export function ImageCompareSlider({
  originalUrl,
  simulatedUrl,
  splitPercent,
  onSplitChange,
  aspectRatio,
}: Props) {
  const s = useLocalized(STRINGS);
  return (
    <div className="space-y-2">
      <div
        className="relative w-full overflow-hidden rounded-lg border bg-muted"
        style={{ aspectRatio }}
        data-testid="cvd-compare"
      >
        <img
          src={simulatedUrl}
          alt={s.simulated}
          className="absolute inset-0 h-full w-full object-contain"
        />
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ clipPath: `inset(0 ${100 - splitPercent}% 0 0)` }}
        >
          <img
            src={originalUrl}
            alt={s.original}
            className="absolute inset-0 h-full w-full object-contain"
          />
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow"
          style={{ left: `${splitPercent}%` }}
        />
        <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
          {s.original}
        </span>
        <span className="pointer-events-none absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
          {s.simulated}
        </span>
      </div>
      <RangeSlider
        label={s.compare}
        unit="%"
        min={0}
        max={100}
        value={splitPercent}
        onChange={onSplitChange}
      />
    </div>
  );
}
