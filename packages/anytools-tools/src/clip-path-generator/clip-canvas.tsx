'use client';
import { type PointerEvent as ReactPointerEvent, useState } from 'react';
import {
  type ClipShape,
  type PolygonShape,
  insertPointAfter,
  movePoint,
  removePoint,
  toCss,
} from './logic';

const STEP = 1; // percent per arrow-key press

type Props = {
  shape: ClipShape;
  onChange: (next: ClipShape) => void;
};

/**
 * Preview plus vertex editor. Handles are absolutely positioned HTML buttons rather
 * than SVG circles: the outline SVG is stretched with preserveAspectRatio="none", which
 * would squash a circle into an ellipse on a non-square box.
 */
export function ClipCanvas({ shape, onChange }: Props) {
  const [dragging, setDragging] = useState<number | null>(null);
  const polygon = shape.kind === 'polygon' ? shape : null;

  const pointFromEvent = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    };
  };

  const handleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging === null || !polygon) return;
    onChange(movePoint(polygon, dragging, pointFromEvent(e)));
  };

  const nudge = (i: number, dx: number, dy: number) => {
    const p = polygon?.points[i];
    if (!polygon || !p) return;
    onChange(movePoint(polygon, i, { x: p.x + dx, y: p.y + dy }));
  };

  return (
    <div
      className="relative h-80 touch-none select-none rounded-lg border bg-muted"
      onPointerMove={handleMove}
      onPointerUp={() => setDragging(null)}
      onPointerCancel={() => setDragging(null)}
      data-testid="clip-canvas"
    >
      {/* Only the artwork is clipped. Clipping the whole canvas cut the outer half off
          every handle sitting on 0% or 100% — most preset vertices — and those halves
          stopped receiving pointer events, so edge vertices could not be grabbed. */}
      <div className="absolute inset-0 overflow-hidden rounded-lg">
        <div
          className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-fuchsia-500"
          style={{ clipPath: toCss(shape) }}
          data-testid="clip-preview"
        />
        {polygon && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full text-slate-900/60"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polygon
              points={polygon.points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="currentColor"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>
      {polygon?.points.map((p, i) => {
        const next = polygon.points[(i + 1) % polygon.points.length] ?? p;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: position in the ring IS the vertex identity and every handler addresses it by index; keying on coordinates would remount the handle on each pointer move and drop keyboard focus mid-edit
          <div key={`vertex-${i}`}>
            <button
              type="button"
              data-vertex={i}
              aria-label={`Vertex ${i + 1} at ${p.x}% ${p.y}% — arrow keys move it, Delete removes it`}
              onPointerDown={(e) => {
                // Capture keeps the moves coming after the pointer leaves the canvas,
                // which is what lets a drag reach 0% and 100% (the clamp in movePoint
                // does the rest) and stops a fast drag from being lost to whatever
                // element the pointer crosses. It replaces an onPointerLeave that used
                // to cancel the drag at the border, exactly where the edge vertices are.
                e.currentTarget.setPointerCapture(e.pointerId);
                // No preventDefault here: Safari and Firefox do not focus a button on
                // click, and suppressing the default would cancel the focus the arrow
                // keys need. Focusing by hand keeps click-then-keyboard working.
                e.currentTarget.focus();
                setDragging(i);
              }}
              onPointerUp={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  e.currentTarget.releasePointerCapture(e.pointerId);
              }}
              onKeyDown={(e) => {
                const map: Record<string, [number, number]> = {
                  ArrowLeft: [-STEP, 0],
                  ArrowRight: [STEP, 0],
                  ArrowUp: [0, -STEP],
                  ArrowDown: [0, STEP],
                };
                const delta = map[e.key];
                if (delta) {
                  e.preventDefault();
                  nudge(i, delta[0] ?? 0, delta[1] ?? 0);
                } else if (e.key === 'Delete' || e.key === 'Backspace') {
                  e.preventDefault();
                  onChange(removePoint(polygon, i));
                }
              }}
              className="absolute -ml-2.5 -mt-2.5 h-5 w-5 cursor-grab rounded-full border-2 border-white bg-slate-900 shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            />
            <button
              type="button"
              data-edge={i}
              aria-label={`Add a vertex on the edge after vertex ${i + 1}`}
              onClick={() => onChange(insertPointAfter(polygon, i))}
              className="absolute -ml-1.5 -mt-1.5 h-3 w-3 rounded-sm border border-slate-900 bg-white opacity-70 hover:opacity-100"
              style={{ left: `${(p.x + next.x) / 2}%`, top: `${(p.y + next.y) / 2}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}
