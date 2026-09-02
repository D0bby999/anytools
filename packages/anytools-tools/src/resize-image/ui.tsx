'use client';
import { Card, CardContent, CardHeader, CardTitle, PrivacyNote } from '@anytools/ui';
import { useState } from 'react';
import type { OutputFormat } from '../shared/canvas-image';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { type ResizeMode, type ResizeResult, resizeImage } from './logic';

const PRESETS = [1920, 1280, 1080, 800, 400];
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

export function ResizeImageUi() {
  const [files, setFiles] = useState<File[]>([]);
  const [kind, setKind] = useState<ResizeMode['kind']>('fit');
  const [maxSide, setMaxSide] = useState(1920);
  const [percent, setPercent] = useState(50);
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(600);
  const [format, setFormat] = useState<OutputFormat>('webp');
  const [result, setResult] = useState<ResizeResult | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const file = files[0] ?? null;

  const mode = (): ResizeMode =>
    kind === 'fit'
      ? { kind: 'fit', maxWidth: maxSide, maxHeight: maxSide }
      : kind === 'percent'
        ? { kind: 'percent', percent }
        : { kind: 'exact', width, height };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const r = await resizeImage(file, mode(), format);
      setResult(r);
      setUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(r.blob);
      });
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : 'Resize failed');
    } finally {
      setBusy(false);
    }
  };

  const outName = file
    ? `${file.name.replace(/\.[^.]+$/, '')}-resized.${format === 'jpeg' ? 'jpg' : format}`
    : 'image';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Resize Image</CardTitle>
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
          label="Image to resize"
        />

        <fieldset className="space-y-2">
          <legend className="text-sm text-muted-foreground">How to size it</legend>
          {(
            [
              ['fit', 'Fit inside a box (keeps the aspect ratio)'],
              ['percent', 'Percentage of the original'],
              ['exact', 'Exact width and height'],
            ] as const
          ).map(([k, labelText]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="resize-mode"
                checked={kind === k}
                onChange={() => setKind(k)}
              />
              {labelText}
            </label>
          ))}
        </fieldset>

        {kind === 'fit' && (
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Longest side (px)</span>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setMaxSide(p)}
                  className={`h-9 rounded-md border px-3 text-sm ${
                    maxSide === p ? 'border-primary bg-primary/10' : 'border-input'
                  }`}
                >
                  {p}
                </button>
              ))}
              <input
                type="number"
                min={1}
                value={maxSide}
                onChange={(e) => setMaxSide(Number(e.target.value))}
                className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </label>
        )}

        {kind === 'percent' && (
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Scale: {percent}%</span>
            <input
              type="range"
              min={1}
              max={200}
              value={percent}
              onChange={(e) => setPercent(Number(e.target.value))}
              className="w-full"
            />
            {percent > 100 && (
              <span className="mt-1 block text-xs text-muted-foreground">
                Above 100% the image is enlarged. Nothing new is added — it will look softer.
              </span>
            )}
          </label>
        )}

        {kind === 'exact' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Width (px)</span>
              <input
                type="number"
                min={1}
                value={width}
                onChange={(e) => setWidth(Number(e.target.value))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Height (px)</span>
              <input
                type="number"
                min={1}
                value={height}
                onChange={(e) => setHeight(Number(e.target.value))}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
          </div>
        )}

        <label className="block text-sm md:w-48">
          <span className="mb-1 block text-muted-foreground">Output format</span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as OutputFormat)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="webp">WEBP</option>
            <option value="jpeg">JPEG</option>
            <option value="png">PNG</option>
          </select>
        </label>

        <button
          type="button"
          onClick={run}
          disabled={!file || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Resizing…' : 'Resize'}
        </button>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {result && url && (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted p-3 text-sm">
              {result.widthBefore} × {result.heightBefore} → {result.width} × {result.height} px ·{' '}
              {kb(result.sizeBefore)} → {kb(result.sizeAfter)}
            </div>
            {/* biome-ignore lint/performance/noImgElement: blob URL preview, not optimizable */}
            <img src={url} alt="Resized" className="max-h-80 rounded border" />
            <a
              href={url}
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
