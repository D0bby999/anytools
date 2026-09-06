/**
 * Ambient types for `three` and two of its example addons.
 *
 * `three@0.185.1` ships no `.d.ts` at all for its own core entry point (`build/three.module.js`,
 * confirmed by `tsc`'s "Could not find a declaration file for module 'three'" — this version
 * dropped the bundled types npm packages used to carry, in favor of the separately-maintained
 * `@types/three`, which is not installed here). `examples/jsm/**` (the loader/controls addons)
 * has never shipped types of its own either way. Declared below is only the surface this tool's
 * `three-mesh-loader.ts` and `ui.tsx` actually call — not `three`'s full API, which is enormous.
 *
 * Pulled in by a triple-slash reference from the two files that need it rather than by
 * `include`: the web app compiles this package's sources through its own tsconfig, whose
 * `include` covers only the app directory, so an ambient file left to be discovered would be
 * found by the package's own typecheck and missed by the app's (same reasoning as
 * `docx-to-markdown/office-libs.d.ts`).
 */

declare module 'three' {
  export class Object3D {
    traverse(callback: (object: Object3D) => void): void;
    add(...objects: Object3D[]): this;
    position: Vector3;
  }

  export class BufferAttribute {
    array: ArrayLike<number>;
    count: number;
  }

  export class BufferGeometry {
    attributes: Record<string, BufferAttribute>;
    getAttribute(name: string): BufferAttribute;
    getIndex(): BufferAttribute | null;
    dispose(): void;
  }

  export class Material {
    dispose(): void;
  }

  export class MeshStandardMaterial extends Material {
    constructor(parameters?: { color?: string | number; wireframe?: boolean });
    color: Color;
    wireframe: boolean;
  }

  export class Mesh extends Object3D {
    constructor(geometry?: BufferGeometry, material?: Material | Material[]);
    readonly isMesh: true;
    geometry: BufferGeometry;
    material: Material | Material[];
  }

  export class Group extends Object3D {}

  export class Scene extends Object3D {
    background: Color | null;
  }

  export class Color {
    constructor(color?: string | number);
    set(color: string | number): this;
  }

  export class Vector3 {
    constructor(x?: number, y?: number, z?: number);
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): this;
    copy(v: Vector3): this;
  }

  export class Box3 {
    constructor();
    setFromObject(object: Object3D): this;
    getCenter(target: Vector3): Vector3;
    getSize(target: Vector3): Vector3;
  }

  export class PerspectiveCamera extends Object3D {
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
    aspect: number;
    near: number;
    far: number;
    updateProjectionMatrix(): void;
  }

  export class WebGLRenderer {
    constructor(parameters?: { antialias?: boolean; preserveDrawingBuffer?: boolean });
    domElement: HTMLCanvasElement;
    setSize(width: number, height: number): void;
    setPixelRatio(ratio: number): void;
    setAnimationLoop(callback: (() => void) | null): void;
    render(scene: Scene, camera: PerspectiveCamera): void;
    dispose(): void;
  }

  export class AmbientLight extends Object3D {
    constructor(color?: string | number, intensity?: number);
  }

  export class DirectionalLight extends Object3D {
    constructor(color?: string | number, intensity?: number);
  }
}

declare module 'three/addons/loaders/STLLoader.js' {
  import type { BufferGeometry } from 'three';

  export class STLLoader {
    parse(data: ArrayBuffer | string): BufferGeometry;
  }
}

declare module 'three/addons/loaders/OBJLoader.js' {
  import type { Group } from 'three';

  export class OBJLoader {
    parse(text: string): Group;
  }
}

declare module 'three/addons/controls/OrbitControls.js' {
  import type { PerspectiveCamera, Vector3 } from 'three';

  export class OrbitControls {
    constructor(object: PerspectiveCamera, domElement?: HTMLElement | null);
    enableDamping: boolean;
    dampingFactor: number;
    readonly target: Vector3;
    update(): boolean;
    dispose(): void;
  }
}
