'use client';
import { useLocalized } from '@anytools/ui';
import { type PointerEvent as ReactPointerEvent, useState } from 'react';
import { type CubicBezier, clampControlPoint } from './logic';
import { STRINGS } from './strings';

/**
 * Vertical range the grid shows. x is always [0,1] (CSS requires it); y extends past that to
 * make room for overshoot easings without the handle running off the visible canvas. Dragging
 * past the grid's edge still works — pointer capture keeps delivering moves, and the value is
 * simply computed past 0%/100%, which is exactly how far the maths already lets y go.
 */
const Y_MIN = -0.6;
const Y_MAX = 1.6;
const STEP = 0.02;

type Props = {
  bezier: CubicBezier;
  onChange: (next: CubicBezier) => void;
};

function toGridX(x: number): number {
  return x * 100;
}
function toGridY(y: number): number {
  return ((Y_MAX - y) / (Y_MAX - Y_MIN)) * 100;
}
function fromGrid(gx: number, gy: number) {
  return clampControlPoint({
    x: gx / 100,
    y: Y_MAX - (gy / 100) * (Y_MAX - Y_MIN),
  });
}

/**
 * Draggable P1/P2 handles over an SVG grid. The curve itself is drawn with the SVG path `C`
 * command using the control points directly — no sampling needed, since a cubic Bezier path
 * command already draws exactly the curve the maths describes.
 */
export function BezierCanvas({ bezier, onChange }: Props) {
  const s = useLocalized(STRINGS);
  const [dragging, setDragging] = useState<1 | 2 | null>(null);

  const pointFromEvent = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return fromGrid(
      ((e.clientX - rect.left) / rect.width) * 100,
      ((e.clientY - rect.top) / rect.height) * 100,
    );
  };

  const handleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging === null) return;
    const p = pointFromEvent(e);
    onChange(dragging === 1 ? { ...bezier, x1: p.x, y1: p.y } : { ...bezier, x2: p.x, y2: p.y });
  };

  const nudge = (which: 1 | 2, dx: number, dy: number) => {
    const cur = which === 1 ? { x: bezier.x1, y: bezier.y1 } : { x: bezier.x2, y: bezier.y2 };
    const next = clampControlPoint({ x: cur.x + dx, y: cur.y + dy });
    onChange(
      which === 1 ? { ...bezier, x1: next.x, y1: next.y } : { ...bezier, x2: next.x, y2: next.y },
    );
  };

  const p0 = { gx: 0, gy: toGridY(0) };
  const p3 = { gx: 100, gy: toGridY(1) };
  const p1 = { gx: toGridX(bezier.x1), gy: toGridY(bezier.y1) };
  const p2 = { gx: toGridX(bezier.x2), gy: toGridY(bezier.y2) };

  const handle = (which: 1 | 2, at: { gx: number; gy: number }, label: string) => (
    <button
      type="button"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus();
        setDragging(which);
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      }}
      onKeyDown={(e) => {
        const map: Record<string, [number, number]> = {
          ArrowLeft: [-STEP, 0],
          ArrowRight: [STEP, 0],
          ArrowUp: [0, STEP],
          ArrowDown: [0, -STEP],
        };
        const delta = map[e.key];
        if (delta) {
          e.preventDefault();
          nudge(which, delta[0] ?? 0, delta[1] ?? 0);
        }
      }}
      aria-label={label}
      className="absolute -ml-3 -mt-3 h-6 w-6 cursor-grab touch-none rounded-full border-2 border-white bg-indigo-600 shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 active:cursor-grabbing"
      style={{ left: `${at.gx}%`, top: `${at.gy}%` }}
    />
  );

  return (
    <div
      className="relative aspect-square w-full max-w-sm touch-none select-none rounded-lg border bg-muted"
      onPointerMove={handleMove}
      onPointerUp={() => setDragging(null)}
      onPointerCancel={() => setDragging(null)}
      data-testid="bezier-canvas"
    >
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {/* Baseline y=0 and y=1, so overshoot past the finish line is visible against something. */}
        <line
          x1={0}
          y1={toGridY(0)}
          x2={100}
          y2={toGridY(0)}
          stroke="currentColor"
          className="text-border"
          strokeWidth={0.5}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={0}
          y1={toGridY(1)}
          x2={100}
          y2={toGridY(1)}
          stroke="currentColor"
          className="text-border"
          strokeWidth={0.5}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={p0.gx}
          y1={p0.gy}
          x2={p1.gx}
          y2={p1.gy}
          stroke="currentColor"
          className="text-indigo-400/70"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={p3.gx}
          y1={p3.gy}
          x2={p2.gx}
          y2={p2.gy}
          stroke="currentColor"
          className="text-indigo-400/70"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={`M ${p0.gx} ${p0.gy} C ${p1.gx} ${p1.gy}, ${p2.gx} ${p2.gy}, ${p3.gx} ${p3.gy}`}
          fill="none"
          stroke="currentColor"
          className="text-indigo-600 dark:text-indigo-400"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {handle(
        1,
        p1,
        s.handleP1.replace('{x}', bezier.x1.toFixed(2)).replace('{y}', bezier.y1.toFixed(2)),
      )}
      {handle(
        2,
        p2,
        s.handleP2.replace('{x}', bezier.x2.toFixed(2)).replace('{y}', bezier.y2.toFixed(2)),
      )}
    </div>
  );
}
