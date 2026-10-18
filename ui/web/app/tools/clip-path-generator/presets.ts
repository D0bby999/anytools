import { type ClipShape, regularPolygon, star } from './logic';

const poly = (...pairs: [number, number][]): ClipShape => ({
  kind: 'polygon',
  points: pairs.map(([x, y]) => ({ x, y })),
});

/** Twelve starting shapes. Every vertex stays draggable after loading one. */
export const CLIP_PRESETS: { name: string; shape: ClipShape }[] = [
  { name: 'Triangle', shape: poly([50, 0], [100, 100], [0, 100]) },
  { name: 'Diamond', shape: poly([50, 0], [100, 50], [50, 100], [0, 50]) },
  { name: 'Pentagon', shape: regularPolygon(5) },
  { name: 'Hexagon', shape: regularPolygon(6) },
  {
    name: 'Octagon',
    shape: poly([30, 0], [70, 0], [100, 30], [100, 70], [70, 100], [30, 100], [0, 70], [0, 30]),
  },
  { name: 'Star', shape: star(5) },
  { name: 'Chevron', shape: poly([75, 0], [100, 50], [75, 100], [0, 100], [25, 50], [0, 0]) },
  {
    name: 'Arrow',
    shape: poly([0, 20], [60, 20], [60, 0], [100, 50], [60, 100], [60, 80], [0, 80]),
  },
  {
    name: 'Cross',
    shape: poly(
      [20, 0],
      [0, 20],
      [30, 50],
      [0, 80],
      [20, 100],
      [50, 70],
      [80, 100],
      [100, 80],
      [70, 50],
      [100, 20],
      [80, 0],
      [50, 30],
    ),
  },
  {
    name: 'Speech bubble',
    shape: poly([0, 0], [100, 0], [100, 75], [75, 75], [75, 100], [50, 75], [0, 75]),
  },
  { name: 'Parallelogram', shape: poly([25, 0], [100, 0], [75, 100], [0, 100]) },
  { name: 'Trapezoid', shape: poly([20, 0], [80, 0], [100, 100], [0, 100]) },
];
