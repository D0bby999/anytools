import { describe, expect, it } from 'vitest';
import { MeshStatsError, computeMeshStats, detectMeshKind } from './logic';

/**
 * A unit cube from (0,0,0) to (1,1,1), 12 triangles, verified by hand (node -e, see phase
 * report) to have consistent outward winding: signed-volume-sum / 6 comes out to exactly 1,
 * not merely |±1| by coincidence of an even number of inward-wound faces cancelling out.
 */
const CUBE_VERTICES: Array<[number, number, number]> = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
const CUBE_TRIANGLES: Array<[number, number, number]> = [
  [0, 2, 1],
  [0, 3, 2], // bottom z=0
  [4, 5, 6],
  [4, 6, 7], // top z=1
  [0, 1, 5],
  [0, 5, 4], // front y=0
  [3, 6, 2],
  [3, 7, 6], // back y=1
  [0, 4, 7],
  [0, 7, 3], // left x=0
  [1, 2, 6],
  [1, 6, 5], // right x=1
];

function indexedCube() {
  return {
    positions: Float32Array.from(CUBE_VERTICES.flat()),
    indices: Uint32Array.from(CUBE_TRIANGLES.flat()),
  };
}

/** Same cube, but every triangle carries its own copy of its 3 vertices — no index buffer. */
function nonIndexedCube() {
  const positions: number[] = [];
  for (const [a, b, c] of CUBE_TRIANGLES) {
    for (const i of [a, b, c]) positions.push(...(CUBE_VERTICES[i] as [number, number, number]));
  }
  return Float32Array.from(positions);
}

describe('detectMeshKind', () => {
  it('recognises .stl and .obj by extension, case-insensitively', () => {
    expect(detectMeshKind('model.stl')).toBe('stl');
    expect(detectMeshKind('MODEL.STL')).toBe('stl');
    expect(detectMeshKind('model.obj')).toBe('obj');
    expect(detectMeshKind('model.gltf')).toBeNull();
    expect(detectMeshKind('no-extension')).toBeNull();
  });
});

describe('computeMeshStats — indexed geometry', () => {
  const { positions, indices } = indexedCube();
  const stats = computeMeshStats(positions, indices);

  it('counts triangles from the index buffer, not the vertex buffer', () => {
    expect(stats.triangleCount).toBe(12);
  });

  it('reports the exact bounding box', () => {
    expect(stats.min).toEqual([0, 0, 0]);
    expect(stats.max).toEqual([1, 1, 1]);
    expect(stats.size).toEqual([1, 1, 1]);
  });

  it('computes the exact volume of a unit cube', () => {
    expect(stats.volume).toBeCloseTo(1, 10);
  });
});

describe('computeMeshStats — non-indexed geometry (STLLoader shape)', () => {
  it('gives the same triangle count, bounding box and volume as the indexed version', () => {
    const stats = computeMeshStats(nonIndexedCube());
    expect(stats.triangleCount).toBe(12);
    expect(stats.min).toEqual([0, 0, 0]);
    expect(stats.max).toEqual([1, 1, 1]);
    expect(stats.volume).toBeCloseTo(1, 10);
  });
});

describe('computeMeshStats — scaled and translated', () => {
  it('scales volume with the cube of the size, and translates the bounding box', () => {
    const { positions, indices } = indexedCube();
    const scaled = positions.map((v, i) => v * 2 + (i % 3 === 0 ? 10 : 0)); // ×2 size, offset on x
    const stats = computeMeshStats(scaled, indices);
    expect(stats.size).toEqual([2, 2, 2]);
    expect(stats.min[0]).toBeCloseTo(10, 10);
    expect(stats.volume).toBeCloseTo(8, 10); // 2^3
  });
});

describe('computeMeshStats — error cases', () => {
  it('rejects an empty mesh', () => {
    expect(() => computeMeshStats(new Float32Array([]))).toThrow(
      expect.objectContaining({ code: 'emptyMesh' }),
    );
  });

  it('rejects a position count that is not a multiple of 3', () => {
    expect(() => computeMeshStats(new Float32Array([1, 2]))).toThrow(
      expect.objectContaining({ code: 'malformedPositions' }),
    );
  });

  it('rejects non-indexed geometry whose vertex count is not a multiple of 3 (triangles)', () => {
    // 5 valid xyz triples (15 numbers) is a whole number of vertices but not of triangles.
    expect(() => computeMeshStats(new Float32Array(15))).toThrow(
      expect.objectContaining({ code: 'malformedPositions' }),
    );
  });

  it('rejects an index count that is not a multiple of 3', () => {
    const { positions } = indexedCube();
    expect(() => computeMeshStats(positions, Uint32Array.from([0, 1]))).toThrow(
      expect.objectContaining({ code: 'malformedIndices' }),
    );
  });

  it('rejects an index pointing past the end of the vertex buffer', () => {
    const { positions } = indexedCube();
    expect(() => computeMeshStats(positions, Uint32Array.from([0, 1, 999]))).toThrow(
      expect.objectContaining({ code: 'indexOutOfRange' }),
    );
  });

  it('is an instance of MeshStatsError', () => {
    expect(() => computeMeshStats(new Float32Array([]))).toThrow(MeshStatsError);
  });
});
