/**
 * Mesh measurements — triangle count, bounding box, volume — computed from plain vertex arrays.
 *
 * Deliberately independent of three.js: `three`'s loaders (STLLoader/OBJLoader) do the actual
 * file parsing and live only in ui.tsx, imported dynamically so the ~600 KB library never lands
 * in a shared bundle chunk (see dynamic-tool-renderer.tsx's ssr:false entry for this tool). This
 * module just receives the two arrays a loaded BufferGeometry already exposes
 * (`.attributes.position.array` and `.index?.array`) and does arithmetic on them, which is
 * exactly as testable without a WebGL context as without three itself.
 */
import { ToolError } from '../shared/tool-error';

export type Vec3 = [number, number, number];

export type MeshStats = {
  triangleCount: number;
  min: Vec3;
  max: Vec3;
  /** max - min per axis — the bounding box a 3D-printer slicer would report. */
  size: Vec3;
  /**
   * Signed-tetrahedron-sum volume, in the file's own units cubed (STL/OBJ carry no unit; by
   * convention this is usually millimeters, but the file never says so — see the FAQ). Accurate
   * only for a closed (manifold, consistently-wound) mesh; an open surface still returns a
   * number, just not a meaningful one.
   */
  volume: number;
};

export class MeshStatsError extends ToolError {
  constructor(code: string, message: string, params: Record<string, string | number> = {}) {
    super(code, message, params);
    this.name = 'MeshStatsError';
  }
}

/** File extension → which loader to use. Returns null for anything this tool does not handle. */
export function detectMeshKind(filename: string): 'stl' | 'obj' | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  return ext === 'stl' || ext === 'obj' ? ext : null;
}

/**
 * Compute triangle count, bounding box and volume from a flat `[x0,y0,z0,x1,y1,z1,…]` position
 * array and an optional flat triangle index array (absent for non-indexed geometry, where every
 * consecutive group of 3 vertices is already one triangle — what STLLoader always produces).
 */
export function computeMeshStats(
  rawPositions: ArrayLike<number>,
  rawIndices?: ArrayLike<number> | null,
): MeshStats {
  if (rawPositions.length === 0) {
    throw new MeshStatsError('emptyMesh', 'This file has no vertices to measure.');
  }
  if (rawPositions.length % 3 !== 0) {
    throw new MeshStatsError(
      'malformedPositions',
      'Vertex data is not a whole number of x/y/z triples.',
    );
  }
  const vertexCount = rawPositions.length / 3;

  let indices: ArrayLike<number>;
  if (rawIndices && rawIndices.length > 0) {
    if (rawIndices.length % 3 !== 0) {
      throw new MeshStatsError(
        'malformedIndices',
        'Index data is not a whole number of triangles.',
      );
    }
    for (let i = 0; i < rawIndices.length; i++) {
      const idx = rawIndices[i] as number;
      if (idx >= vertexCount) {
        throw new MeshStatsError(
          'indexOutOfRange',
          `A triangle references vertex ${idx}, but the file only has ${vertexCount}.`,
          { index: idx, count: vertexCount },
        );
      }
    }
    indices = rawIndices;
  } else {
    if (vertexCount % 3 !== 0) {
      throw new MeshStatsError(
        'malformedPositions',
        'Non-indexed geometry must come in groups of three vertices per triangle.',
      );
    }
    indices = { length: vertexCount };
  }
  const indexed = rawIndices && rawIndices.length > 0;

  const min: Vec3 = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: Vec3 = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let i = 0; i < vertexCount; i++) {
    for (let a = 0; a < 3; a++) {
      const v = rawPositions[i * 3 + a] as number;
      if (v < (min[a] as number)) min[a] = v;
      if (v > (max[a] as number)) max[a] = v;
    }
  }

  const triangleCount = indices.length / 3;
  let signedVolumeSum6 = 0;
  for (let t = 0; t < triangleCount; t++) {
    const ia = indexed ? (indices[t * 3] as number) : t * 3;
    const ib = indexed ? (indices[t * 3 + 1] as number) : t * 3 + 1;
    const ic = indexed ? (indices[t * 3 + 2] as number) : t * 3 + 2;
    const ax = rawPositions[ia * 3] as number;
    const ay = rawPositions[ia * 3 + 1] as number;
    const az = rawPositions[ia * 3 + 2] as number;
    const bx = rawPositions[ib * 3] as number;
    const by = rawPositions[ib * 3 + 1] as number;
    const bz = rawPositions[ib * 3 + 2] as number;
    const cx = rawPositions[ic * 3] as number;
    const cy = rawPositions[ic * 3 + 1] as number;
    const cz = rawPositions[ic * 3 + 2] as number;
    // Signed volume of the tetrahedron (origin, a, b, c) — the divergence-theorem trick for
    // mesh volume: summed over every triangle of a closed, consistently-wound surface, this
    // telescopes to exactly 6× the enclosed volume regardless of the mesh's shape.
    signedVolumeSum6 +=
      ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }

  return {
    triangleCount,
    min,
    max,
    size: [
      (max[0] as number) - (min[0] as number),
      (max[1] as number) - (min[1] as number),
      (max[2] as number) - (min[2] as number),
    ],
    volume: Math.abs(signedVolumeSum6) / 6,
  };
}
