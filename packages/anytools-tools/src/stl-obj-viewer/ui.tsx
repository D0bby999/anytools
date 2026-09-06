/// <reference path="./three-types.d.ts" />
'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  PrivacyNote,
  useLocalized,
} from '@anytools/ui';
import { useEffect, useRef, useState } from 'react';
import type {
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { toolErrorText } from '../shared/tool-error';
import { type MeshStats, computeMeshStats, detectMeshKind } from './logic';
import { STRINGS } from './strings';
import { applyMaterial, loadObj, loadStl } from './three-mesh-loader';

const VIEWPORT_HEIGHT = 420;
const fmtNum = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(1) : n.toFixed(3));

type OrbitControlsLike = { enableDamping: boolean; update(): boolean; dispose(): void };

/** Everything a mounted scene owns — kept in one ref so a file change can tear it all down. */
type SceneHandles = {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControlsLike;
  material: MeshStandardMaterial;
  object: Object3D;
  fitCamera: () => void;
};

function disposeScene(handles: SceneHandles | null, container: HTMLDivElement | null): void {
  if (!handles) return;
  handles.renderer.setAnimationLoop(null);
  handles.controls.dispose();
  handles.object.traverse((child) => {
    const mesh = child as Mesh;
    if (mesh.isMesh) mesh.geometry?.dispose();
  });
  handles.material.dispose();
  handles.renderer.dispose();
  if (container && handles.renderer.domElement.parentElement === container) {
    container.removeChild(handles.renderer.domElement);
  }
}

export function StlObjViewerUi() {
  const s = useLocalized(STRINGS);
  const [files, setFiles] = useState<File[]>([]);
  const [stats, setStats] = useState<MeshStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [color, setColor] = useState('#7c9cff');

  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandles | null>(null);
  const file = files[0] ?? null;

  // Build (or rebuild) the scene whenever a new file is picked. Everything three-related is
  // dynamically imported here — see three-mesh-loader.ts's header for why that matters for
  // bundle size, and dynamic-tool-renderer.tsx's ssr:false entry for why this tool never runs
  // on the server at all.
  //
  // color/wireframe/s are deliberately not deps: color and wireframe are read once, as the
  // starting material for a freshly loaded file — the two effects below push their live values
  // into the already-mounted material on every change instead of re-running this whole effect
  // (which would reload the file). `s` (the strings table) changes only on a locale switch and
  // is memoized per render regardless.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    setStats(null);
    setError(null);
    if (!file || !containerRef.current) return;

    const kind = detectMeshKind(file.name);
    if (!kind) {
      setError(s.unsupportedExtension);
      return;
    }

    let cancelled = false;
    setLoading(true);
    trackEvent('tool_run', { tool: 'stl-obj-viewer' });

    (async () => {
      const [THREE, { OrbitControls }] = await Promise.all([
        import('three'),
        import('three/addons/controls/OrbitControls.js'),
      ]);
      const loaded = kind === 'stl' ? await loadStl(file) : await loadObj(file);
      const meshStats = computeMeshStats(loaded.positions, loaded.indices);
      if (cancelled || !containerRef.current) return;

      disposeScene(sceneRef.current, containerRef.current);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf1f5f9);
      const width = containerRef.current.clientWidth || 640;
      const camera = new THREE.PerspectiveCamera(50, width / VIEWPORT_HEIGHT, 0.01, 1e6);
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setSize(width, VIEWPORT_HEIGHT);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      containerRef.current.replaceChildren(renderer.domElement);

      scene.add(new THREE.AmbientLight(0xffffff, 0.7));
      const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
      dirLight.position.set(1, 1.5, 1);
      scene.add(dirLight);

      const material = new THREE.MeshStandardMaterial({ color, wireframe });
      applyMaterial(loaded.object, material);
      scene.add(loaded.object);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;

      const fitCamera = () => {
        const box = new THREE.Box3().setFromObject(loaded.object);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        camera.position.set(center.x + maxDim, center.y + maxDim * 0.8, center.z + maxDim);
        camera.near = maxDim / 100;
        camera.far = maxDim * 100;
        camera.updateProjectionMatrix();
        controls.target.copy(center);
        controls.update();
      };
      fitCamera();

      renderer.setAnimationLoop(() => {
        controls.update();
        renderer.render(scene, camera);
      });

      sceneRef.current = {
        renderer,
        scene,
        camera,
        controls,
        material,
        object: loaded.object,
        fitCamera,
      };
      setStats(meshStats);
    })()
      .catch((e) => {
        if (!cancelled) setError(toolErrorText(e, s, s.loadFailed));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [file]);

  // Unmount cleanup only — a WebGL context is a scarce, non-GC'd browser resource.
  useEffect(() => () => disposeScene(sceneRef.current, containerRef.current), []);

  useEffect(() => {
    if (sceneRef.current) sceneRef.current.material.wireframe = wireframe;
  }, [wireframe]);

  useEffect(() => {
    sceneRef.current?.material.color.set(color);
  }, [color]);

  useEffect(() => {
    const onResize = () => {
      const handles = sceneRef.current;
      const container = containerRef.current;
      if (!handles || !container) return;
      const width = container.clientWidth || 640;
      handles.camera.aspect = width / VIEWPORT_HEIGHT;
      handles.camera.updateProjectionMatrix();
      handles.renderer.setSize(width, VIEWPORT_HEIGHT);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const screenshot = () => {
    const handles = sceneRef.current;
    if (!handles) return;
    handles.renderer.render(handles.scene, handles.camera);
    handles.renderer.domElement.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(file?.name ?? 'model').replace(/\.[^.]+$/, '')}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MultiFileDropzone
          files={files}
          onChange={setFiles}
          accept=".stl,.obj"
          multiple={false}
          label={s.fileLabel}
        />

        {loading && <p className="text-sm text-muted-foreground">{s.loading}</p>}
        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        <div
          ref={containerRef}
          className={file && !error ? 'block overflow-hidden rounded-md border' : 'hidden'}
          style={{ height: VIEWPORT_HEIGHT }}
        />

        {stats && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={wireframe}
                  onChange={(e) => setWireframe(e.target.checked)}
                />
                {s.wireframe}
              </label>
              <div className="flex items-center gap-2">
                {/* htmlFor rather than wrapping: <Input> is a component, and the a11y rule
                    (rightly) cannot see an input inside it. */}
                <label htmlFor="stl-obj-viewer-color" className="text-sm">
                  {s.colorLabel}
                </label>
                <Input
                  id="stl-obj-viewer-color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-8 w-14 p-1"
                />
              </div>
              <button
                type="button"
                onClick={() => sceneRef.current?.fitCamera()}
                className="inline-flex h-8 items-center justify-center rounded-md border px-3 text-sm hover:bg-muted"
              >
                {s.resetView}
              </button>
              <button
                type="button"
                onClick={screenshot}
                className="inline-flex h-8 items-center justify-center rounded-md border px-3 text-sm hover:bg-muted"
              >
                {s.screenshot}
              </button>
            </div>

            <p className="text-sm text-muted-foreground">
              {s.statsTriangles}: {stats.triangleCount.toLocaleString()}
            </p>
            <p className="text-sm text-muted-foreground">
              {s.statsSize
                .replace('{x}', fmtNum(stats.size[0]))
                .replace('{y}', fmtNum(stats.size[1]))
                .replace('{z}', fmtNum(stats.size[2]))}
            </p>
            <p className="text-sm text-muted-foreground">
              {s.statsVolume.replace('{volume}', `${fmtNum(stats.volume)} mm³`)}
            </p>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
