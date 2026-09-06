/// <reference path="./three-types.d.ts" />
/**
 * Parse a .stl or .obj file with three's own loaders and flatten whatever it returns into the
 * plain `positions`/`indices` arrays `../logic.ts`'s `computeMeshStats` measures.
 *
 * Everything here is dynamically imported — `three` plus its two loader addons are roughly
 * 600 KB combined, and importing this module (from ui.tsx, itself only reachable through
 * dynamic-tool-renderer.tsx's `dynamic(() => import(...))`) must not pull any of that into a
 * shared chunk. See the phase report for the bundle-size check.
 *
 * STLLoader always returns a single non-indexed BufferGeometry (the STL format has no shared-
 * vertex indexing — every triangle repeats its own 3 vertices). OBJLoader returns a Group that
 * can contain several Mesh children (one per named object/material group in the file), so those
 * are walked and concatenated into one flat buffer, offsetting each mesh's indices by the
 * running vertex count — the same trick BufferGeometryUtils.mergeGeometries uses.
 */
import type { BufferGeometry, Mesh, Object3D } from 'three';

export type LoadedMesh = {
  /** Ready to add to a scene; carries no material yet — the caller assigns one. */
  object: Object3D;
  positions: Float32Array;
  indices: Uint32Array | null;
};

function collectMeshes(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((child) => {
    if ((child as Mesh).isMesh) meshes.push(child as Mesh);
  });
  return meshes;
}

function toFloat32(attr: BufferGeometry['attributes'][string]): Float32Array {
  return attr.array instanceof Float32Array
    ? attr.array
    : Float32Array.from(attr.array as ArrayLike<number>);
}

/** Concatenate every mesh's position/index data into one flat pair, offsetting indices as we go. */
function mergeMeshes(meshes: Mesh[]): { positions: Float32Array; indices: Uint32Array | null } {
  const positions: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;
  let anyIndexed = false;

  for (const mesh of meshes) {
    const posAttr = mesh.geometry.getAttribute('position');
    positions.push(...toFloat32(posAttr));
    const idxAttr = mesh.geometry.getIndex();
    if (idxAttr) {
      anyIndexed = true;
      for (let i = 0; i < idxAttr.count; i++)
        indices.push((idxAttr.array[i] as number) + vertexOffset);
    } else {
      for (let i = 0; i < posAttr.count; i++) indices.push(i + vertexOffset);
    }
    vertexOffset += posAttr.count;
  }

  return {
    positions: Float32Array.from(positions),
    indices: anyIndexed || meshes.length > 1 ? Uint32Array.from(indices) : null,
  };
}

/** Every mesh in `object` gets the same material — a viewer shows one surface, not per-group looks. */
export function applyMaterial(object: Object3D, material: import('three').Material): void {
  object.traverse((child) => {
    if ((child as Mesh).isMesh) (child as Mesh).material = material;
  });
}

export async function loadStl(file: File): Promise<LoadedMesh> {
  const [THREE, { STLLoader }] = await Promise.all([
    import('three'),
    import('three/addons/loaders/STLLoader.js'),
  ]);
  const geometry = new STLLoader().parse(await file.arrayBuffer());
  const mesh = new THREE.Mesh(geometry);
  const posAttr = geometry.getAttribute('position');
  const idxAttr = geometry.getIndex();
  return {
    object: mesh,
    positions: toFloat32(posAttr),
    indices: idxAttr ? Uint32Array.from(idxAttr.array as ArrayLike<number>) : null,
  };
}

export async function loadObj(file: File): Promise<LoadedMesh> {
  const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
  const group = new OBJLoader().parse(await file.text());
  const meshes = collectMeshes(group);
  if (meshes.length === 0) {
    throw new Error('This OBJ file has no mesh geometry — only points, lines, or an empty scene.');
  }
  const { positions, indices } = mergeMeshes(meshes);
  return { object: group, positions, indices };
}
