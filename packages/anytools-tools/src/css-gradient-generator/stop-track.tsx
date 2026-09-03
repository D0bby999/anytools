'use client';
import { type PointerEvent as ReactPointerEvent, useState } from 'react';
import { type ColorStop, pointerPercent, toCss, trackPositions } from './logic';
import type { StopRow } from './stop-rows';

const STEP = 1; // percent per arrow-key press
const BIG_STEP = 10; // with Shift held

type Props = {
  rows: StopRow[];
  onMove: (index: number, position: number) => void;
};

/**
 * The gradient line, laid out horizontally, with one draggable handle per stop.
 *
 * The ramp is always drawn as a 90deg linear gradient whatever the real kind is: the
 * stop list is one-dimensional in every gradient function, and a conic ramp bent around
 * a circle would make the handles unreachable.
 */
export function StopTrack({ rows, onMove }: Props) {
  const [dragging, setDragging] = useState<number | null>(null);
  const positions = trackPositions(rows);
  // Only the ramp needs the resolved positions; the rows keep whatever the user typed.
  const ramp: ColorStop[] = rows.map((row, i) => ({
    color: row.color,
    position: positions[i] ?? 0,
  }));

  const drag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging === null) return;
    onMove(dragging, pointerPercent(e.clientX, e.currentTarget.getBoundingClientRect()));
  };

  const nudge = (index: number, delta: number) => {
    const at = positions[index];
    if (at === undefined) return;
    onMove(index, Math.max(0, Math.min(100, at + delta)));
  };

  return (
    <div
      className="relative h-12 touch-none select-none"
      onPointerMove={drag}
      onPointerUp={() => setDragging(null)}
      onPointerCancel={() => setDragging(null)}
      data-testid="stop-track"
    >
      <div
        className="absolute inset-x-0 top-1 h-6 rounded-md border"
        style={{
          background: toCss({ kind: 'linear', angle: 90, repeating: false, stops: ramp }),
        }}
        aria-hidden="true"
      />
      {rows.map((row, i) => (
        <button
          key={row.id}
          type="button"
          data-stop-handle={i}
          aria-label={`Stop ${i + 1} at ${positions[i] ?? 0}% — drag, or use the arrow keys`}
          style={{ left: `${positions[i] ?? 0}%` }}
          className="absolute top-0 -ml-2 h-8 w-4 cursor-grab rounded-md border-2 border-white bg-slate-900 shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          onPointerDown={(e) => {
            // Capture keeps the moves coming after the pointer leaves the track, which
            // is what lets a drag reach 0% and 100%, and stops a fast drag from being
            // lost to whatever element the pointer happens to cross.
            e.currentTarget.setPointerCapture(e.pointerId);
            // No preventDefault: Safari and Firefox do not focus a button on click, and
            // suppressing the default would also cancel the focus we need for the arrow
            // keys. Focusing by hand keeps click-then-keyboard working everywhere.
            e.currentTarget.focus();
            setDragging(i);
          }}
          onPointerUp={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? BIG_STEP : STEP;
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              nudge(i, e.key === 'ArrowLeft' ? -step : step);
            } else if (e.key === 'Home' || e.key === 'End') {
              e.preventDefault();
              onMove(i, e.key === 'Home' ? 0 : 100);
            }
          }}
        />
      ))}
    </div>
  );
}
