'use client';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote } from '@anytools/ui';
import { useEffect, useRef, useState } from 'react';
import type { OutputFormat } from '../shared/canvas-image';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import {
  ASPECT_PRESETS,
  type CropRect,
  type CropResult,
  applyAspect,
  clampRect,
  cropImage,
} from './logic';

const FULL: CropRect = { x: 0, y: 0, width: 1, height: 1 };
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

export function CropImageUi() {
  const [files, setFiles] = useState<File[]>([]);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [rect, setRect] = useState<CropRect>(FULL);
  const [aspect, setAspect] = useState<number | null>(null);
  const [format, setFormat] = useState<OutputFormat>('png');
  const [result, setResult] = useState<CropResult | null>(null);
  const [outUrl, setOutUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const frameRef = useRef<HTMLDivElement>(null);
  // Pointer events rather than mouse events: one code path covers mouse, touch and pen, and
  // setPointerCapture keeps the drag alive when the finger leaves the element.
  const drag = useRef<{ startX: number; startY: number } | null>(null);

  const file = files[0] ?? null;

  useEffect(() => {
    setSrcUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
    setRect(FULL);
    setResult(null);
  }, [file]);

  const toFraction = (clientX: number, clientY: number) => {
    const box = frameRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return {
      x: Math.min(Math.max((clientX - box.left) / box.width, 0), 1),
      y: Math.min(Math.max((clientY - box.top) / box.height, 0), 1),
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toFraction(e.clientX, e.clientY);
    drag.current = { startX: p.x, startY: p.y };
    setRect({ x: p.x, y: p.y, width: 0.001, height: 0.001 });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !natural) return;
    const p = toFraction(e.clientX, e.clientY);
    const next = clampRect({
      x: Math.min(drag.current.startX, p.x),
      y: Math.min(drag.current.startY, p.y),
      width: Math.abs(p.x - drag.current.startX),
      height: Math.abs(p.y - drag.current.startY),
    });
    setRect(aspect ? applyAspect(next, aspect, natural.w, natural.h) : next);
  };

  const endDrag = () => {
    drag.current = null;
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await cropImage(file, rect, format);
      setResult(r);
      setOutUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(r.blob);
      });
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : 'Crop failed');
    } finally {
      setBusy(false);
    }
  };

  const cropPx = natural
    ? {
        w: Math.round(rect.width * natural.w),
        h: Math.round(rect.height * natural.h),
      }
    : null;
  const outName = file
    ? `${file.name.replace(/\.[^.]+$/, '')}-cropped.${format === 'jpeg' ? 'jpg' : format}`
    : 'image';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Crop Image</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MultiFileDropzone
          files={files}
          onChange={(f) => {
            setFiles(f);
            setResult(null);
            setError(null);
          }}
          accept="image/*"
          multiple={false}
          label="Image to crop"
        />

        {srcUrl && (
          <>
            <div className="flex flex-wrap gap-2">
              {ASPECT_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setAspect(p.ratio);
                    if (p.ratio && natural)
                      setRect((r) => applyAspect(r, p.ratio as number, natural.w, natural.h));
                  }}
                  className={`h-9 rounded-md border px-3 text-sm ${
                    aspect === p.ratio ? 'border-primary bg-primary/10' : 'border-input'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* biome-ignore lint/a11y/noStaticElementInteractions: a crop surface is inherently pointer-driven; the numeric readout below reports the selection for non-pointer users */}
            <div
              ref={frameRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className="relative inline-block max-w-full touch-none select-none overflow-hidden rounded border"
            >
              {/* biome-ignore lint/performance/noImgElement: blob URL preview, not optimizable */}
              <img
                src={srcUrl}
                alt="Drag on this image to choose the crop area"
                onLoad={(e) =>
                  setNatural({
                    w: e.currentTarget.naturalWidth,
                    h: e.currentTarget.naturalHeight,
                  })
                }
                className="block max-h-96 w-auto"
                draggable={false}
              />
              <div
                className="pointer-events-none absolute border-2 border-primary bg-primary/10"
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.width * 100}%`,
                  height: `${rect.height * 100}%`,
                }}
              />
            </div>

            <p className="text-sm text-muted-foreground">
              Drag on the image to select an area.
              {cropPx && ` Selection: ${cropPx.w} × ${cropPx.h} px`}
              {natural && ` of ${natural.w} × ${natural.h}`}
            </p>

            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">Output format</span>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as OutputFormat)}
                  className="h-10 w-40 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="png">PNG</option>
                  <option value="webp">WEBP</option>
                  <option value="jpeg">JPEG</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => setRect(FULL)}
                className="h-10 rounded-md border border-input px-3 text-sm"
              >
                Reset selection
              </button>
              <button
                type="button"
                onClick={run}
                disabled={busy}
                className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                {busy ? 'Cropping…' : 'Crop'}
              </button>
            </div>
          </>
        )}

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {result && outUrl && (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted p-3 text-sm">
              {result.width} × {result.height} px · {kb(result.sizeBefore)} → {kb(result.sizeAfter)}
            </div>
            {/* biome-ignore lint/performance/noImgElement: blob URL preview, not optimizable */}
            <img src={outUrl} alt="Cropped result" className="max-h-80 rounded border" />
            <a
              href={outUrl}
              download={outName}
              className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Download {outName}
            </a>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
