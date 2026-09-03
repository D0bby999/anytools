/**
 * `clip-path` basic shapes <-> CSS text. Implemented from the property and the
 * <basic-shape> definitions:
 * https://developer.mozilla.org/en-US/docs/Web/CSS/clip-path
 * https://developer.mozilla.org/en-US/docs/Web/CSS/basic-shape
 *
 * Every coordinate is stored as a percentage of the reference box, which is what makes
 * a shape resolution-independent. `toCss` can also emit px against a given box size for
 * people who need fixed geometry; the state itself never stores px.
 */

export type Point = { x: number; y: number };

export type PolygonShape = { kind: 'polygon'; points: Point[] };
export type CircleShape = { kind: 'circle'; r: number; cx: number; cy: number };
export type EllipseShape = { kind: 'ellipse'; rx: number; ry: number; cx: number; cy: number };
export type InsetShape = {
  kind: 'inset';
  top: number;
  right: number;
  bottom: number;
  left: number;
  round: number;
};
export type ClipShape = PolygonShape | CircleShape | EllipseShape | InsetShape;

export type Unit = '%' | 'px';
/** Reference box in px. Required when `unit` is 'px'; ignored otherwise. */
export type Box = { width: number; height: number };

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function fmt(percent: number, unit: Unit, basis: number): string {
  return unit === 'px' ? `${Math.round((percent / 100) * basis)}px` : `${round(percent)}%`;
}

export function toCss(
  shape: ClipShape,
  unit: Unit = '%',
  box: Box = { width: 0, height: 0 },
): string {
  const x = (v: number) => fmt(v, unit, box.width);
  const y = (v: number) => fmt(v, unit, box.height);
  // A circle radius is resolved against the diagonal, not a single axis:
  // sqrt(w² + h²) / sqrt(2). Using the width would make px output disagree with %.
  const diagonal = Math.sqrt((box.width ** 2 + box.height ** 2) / 2);
  switch (shape.kind) {
    case 'polygon':
      return `polygon(${shape.points.map((p) => `${x(p.x)} ${y(p.y)}`).join(', ')})`;
    case 'circle':
      return `circle(${fmt(shape.r, unit, diagonal)} at ${x(shape.cx)} ${y(shape.cy)})`;
    case 'ellipse':
      return `ellipse(${x(shape.rx)} ${y(shape.ry)} at ${x(shape.cx)} ${y(shape.cy)})`;
    case 'inset': {
      const sides = `${y(shape.top)} ${x(shape.right)} ${y(shape.bottom)} ${x(shape.left)}`;
      return shape.round > 0
        ? `inset(${sides} round ${fmt(shape.round, unit, box.width)})`
        : `inset(${sides})`;
    }
  }
}

export function toCssBlock(shape: ClipShape, unit: Unit = '%', box?: Box): string {
  return `clip-path: ${toCss(shape, unit, box)};`;
}

/** Clamp to the reference box and round to 0.1% — the precision the CSS needs. */
export function clampPoint(p: Point): Point {
  return { x: round(Math.max(0, Math.min(100, p.x))), y: round(Math.max(0, Math.min(100, p.y))) };
}

export function movePoint(shape: PolygonShape, index: number, to: Point): PolygonShape {
  return {
    kind: 'polygon',
    points: shape.points.map((p, i) => (i === index ? clampPoint(to) : p)),
  };
}

/**
 * Insert a vertex at the midpoint of the edge that starts at `index`. The last edge
 * wraps to the first point, which is where a naive implementation drops a vertex.
 */
export function insertPointAfter(shape: PolygonShape, index: number): PolygonShape {
  const a = shape.points[index];
  const b = shape.points[(index + 1) % shape.points.length];
  if (!a || !b) return shape;
  const next = [...shape.points];
  next.splice(index + 1, 0, clampPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }));
  return { kind: 'polygon', points: next };
}

/** A polygon needs three vertices to enclose anything; below that, refuse to remove. */
export function removePoint(shape: PolygonShape, index: number): PolygonShape {
  if (shape.points.length <= 3) return shape;
  return { kind: 'polygon', points: shape.points.filter((_, i) => i !== index) };
}

/** Regular n-gon inscribed in the box, first vertex at the top. Used by the presets. */
export function regularPolygon(sides: number, rotationDeg = -90): PolygonShape {
  const points = Array.from({ length: sides }, (_, i) => {
    const angle = ((rotationDeg + (360 / sides) * i) * Math.PI) / 180;
    return clampPoint({ x: 50 + 50 * Math.cos(angle), y: 50 + 50 * Math.sin(angle) });
  });
  return { kind: 'polygon', points };
}

/** n-pointed star: outer vertices on the box edge, inner ones at `innerRatio`. */
export function star(points: number, innerRatio = 0.5): PolygonShape {
  const verts = Array.from({ length: points * 2 }, (_, i) => {
    const radius = i % 2 === 0 ? 50 : 50 * innerRatio;
    const angle = ((-90 + (360 / (points * 2)) * i) * Math.PI) / 180;
    return clampPoint({ x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) });
  });
  return { kind: 'polygon', points: verts };
}
