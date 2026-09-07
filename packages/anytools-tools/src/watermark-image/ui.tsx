'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  MultiFileDropzone,
  PrivacyNote,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadBitmap } from '../shared/canvas-image';
import { SHARED_ERROR_STRINGS, returnedErrorText } from '../shared/shared-error-strings';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import type { GridPosition, WatermarkFailure, WatermarkOptions, WatermarkResult } from './logic';
import { previewWatermark, watermarkImages, zipWatermarked } from './logic';
import { STRINGS } from './strings';

const SLUG = 'watermark-image';
const kb = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
const GRID: GridPosition[] = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'center',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];
const PREVIEW_MAX_SIDE = 480;
const PREVIEW_DEBOUNCE_MS = 150;

export function WatermarkImageUi() {
  const s = useLocalized(STRINGS);
  const sharedErrors = useLocalized(SHARED_ERROR_STRINGS);
  const errorStrings = useMemo(() => ({ ...sharedErrors, ...s }), [sharedErrors, s]);
  const ui = useUiStrings();
  const objectUrls = useObjectUrls();

  const [files, setFiles] = useState<File[]>([]);
  const [markKind, setMarkKind] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('© Your Name');
  const [color, setColor] = useState('#ffffff');
  const [sizePercent, setSizePercent] = useState(8);
  const [logoFiles, setLogoFiles] = useState<File[]>([]);
  const [positionMode, setPositionMode] = useState<'grid' | 'custom'>('grid');
  const [grid, setGrid] = useState<GridPosition>('center');
  const [xPercent, setXPercent] = useState(50);
  const [yPercent, setYPercent] = useState(50);
  const [opacityPct, setOpacityPct] = useState(50);
  const [rotation, setRotation] = useState(0);
  const [tile, setTile] = useState(false);
  const [format, setFormat] = useState<WatermarkOptions['format']>('original');
  const [quality, setQuality] = useState(0.92);

  const [results, setResults] = useState<WatermarkResult[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [failures, setFailures] = useState<WatermarkFailure[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const logoBitmapRef = useRef<ImageBitmap | null>(null);
  const [logoBitmap, setLogoBitmap] = useState<ImageBitmap | null>(null);

  // Decode the logo once per selection; the same decoded bitmap is reused for both the live
  // preview and every image in the export batch, never re-decoded per file.
  useEffect(() => {
    const logoFile = logoFiles[0] ?? null;
    if (!logoFile) {
      logoBitmapRef.current?.close();
      logoBitmapRef.current = null;
      setLogoBitmap(null);
      return;
    }
    let cancelled = false;
    loadBitmap(logoFile)
      .then((bmp) => {
        if (cancelled) return bmp.close();
        logoBitmapRef.current?.close();
        logoBitmapRef.current = bmp;
        setLogoBitmap(bmp);
      })
      .catch(() => {
        if (!cancelled) setLogoBitmap(null);
      });
    return () => {
      cancelled = true;
    };
  }, [logoFiles]);

  // Release the last decoded logo bitmap on unmount — the effect above only closes the
  // PREVIOUS bitmap when a new one arrives, never the final one still held on the way out.
  useEffect(() => () => logoBitmapRef.current?.close(), []);

  const opts: WatermarkOptions = useMemo(() => {
    const position: WatermarkOptions['position'] =
      positionMode === 'custom' ? { kind: 'custom', xPercent, yPercent } : { kind: 'grid', grid };
    const base = { position, opacity: opacityPct / 100, rotation, tile, format, quality };
    return markKind === 'text'
      ? { kind: 'text', text, color, sizePercent, ...base }
      : { kind: 'image', scalePercent: sizePercent, ...base };
  }, [
    markKind,
    text,
    color,
    sizePercent,
    positionMode,
    grid,
    xPercent,
    yPercent,
    opacityPct,
    rotation,
    tile,
    format,
    quality,
  ]);

  // Live preview: debounced so dragging a slider does not re-render a canvas on every tick.
  // objectUrls/errorStrings/s are omitted from deps: all three are memoized per render (see
  // use-object-urls.ts and useLocalized), so including them would not change when this effect
  // re-runs — only churn it on every locale switch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    const file = files[0];
    if (!file || (opts.kind === 'image' && !logoBitmap)) {
      setPreviewUrl(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      previewWatermark(file, opts, logoBitmap ?? undefined, PREVIEW_MAX_SIDE)
        .then((blob) => {
          if (cancelled) return;
          setPreviewError(null);
          setPreviewUrl((prev) => {
            if (prev) objectUrls.revoke(prev);
            return objectUrls.create(blob);
          });
        })
        .catch((e) => {
          if (cancelled) return;
          setPreviewUrl(null);
          setPreviewError(toolErrorText(e, errorStrings, s.previewFailed));
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [files, opts, logoBitmap]);

  const reset = () => {
    objectUrls.revokeAll();
    setResults([]);
    setPreviews([]);
    setFailures([]);
    setError(null);
    setProgress(null);
  };

  const run = async () => {
    if (files.length === 0) return;
    reset();
    setBusy(true);
    trackEvent('tool_run', { tool: SLUG });
    try {
      const outcome = await watermarkImages(files, opts, logoFiles[0] ?? null, (done, total) =>
        setProgress({ done, total }),
      );
      setResults(outcome.results);
      setPreviews(outcome.results.map((r) => objectUrls.create(r.blob)));
      setFailures(outcome.failures);
    } catch (e) {
      setError(toolErrorText(e, errorStrings, s.failed));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const saveBlob = (blob: Blob, filename: string) => {
    const url = objectUrls.create(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => objectUrls.revoke(url), 30_000);
  };

  const downloadAll = async () => {
    setError(null);
    try {
      saveBlob(await zipWatermarked(results), 'watermarked-images.zip');
    } catch (e) {
      setError(toolErrorText(e, errorStrings, s.zipFailed));
    }
  };

  const gridLabel: Record<GridPosition, string> = {
    'top-left': s.grid_topLeft,
    'top-center': s.grid_topCenter,
    'top-right': s.grid_topRight,
    'middle-left': s.grid_middleLeft,
    center: s.grid_center,
    'middle-right': s.grid_middleRight,
    'bottom-left': s.grid_bottomLeft,
    'bottom-center': s.grid_bottomCenter,
    'bottom-right': s.grid_bottomRight,
  };
  const runLabel =
    files.length > 1 ? s.watermarkMany.replace('{n}', String(files.length)) : s.watermarkOne;
  const canRun =
    files.length > 0 && (markKind === 'text' ? text.trim().length > 0 : Boolean(logoFiles[0]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MultiFileDropzone
          files={files}
          onChange={(f) => {
            setFiles(f);
            reset();
          }}
          accept="image/*"
          multiple
          label={s.dropLabel}
        />

        <fieldset className="flex gap-2">
          <legend className="mb-1 block text-sm text-muted-foreground">{s.markKind}</legend>
          {(['text', 'image'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setMarkKind(k)}
              className={`h-9 rounded-md border px-3 text-sm ${markKind === k ? 'border-primary bg-primary/10' : 'border-input'}`}
            >
              {k === 'text' ? s.markKindText : s.markKindImage}
            </button>
          ))}
        </fieldset>

        {markKind === 'text' ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">{s.textLabel}</span>
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={s.textPlaceholder}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">{s.colorLabel}</span>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-1"
              />
            </label>
          </div>
        ) : (
          <MultiFileDropzone
            files={logoFiles}
            onChange={setLogoFiles}
            accept="image/*"
            multiple={false}
            label={s.logoDropLabel}
          />
        )}

        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">
            {s.sizeLabel.replace('{n}', String(sizePercent))}
          </span>
          <input
            type="range"
            min={1}
            max={50}
            value={sizePercent}
            onChange={(e) => setSizePercent(Number(e.target.value))}
            className="w-full"
          />
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm text-muted-foreground">{s.positionLabel}</legend>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPositionMode('grid')}
              className={`h-9 rounded-md border px-3 text-sm ${positionMode === 'grid' ? 'border-primary bg-primary/10' : 'border-input'}`}
            >
              {s.positionLabel}
            </button>
            <button
              type="button"
              onClick={() => setPositionMode('custom')}
              className={`h-9 rounded-md border px-3 text-sm ${positionMode === 'custom' ? 'border-primary bg-primary/10' : 'border-input'}`}
            >
              {s.positionCustom}
            </button>
          </div>
          {positionMode === 'grid' ? (
            <div className="grid w-40 grid-cols-3 gap-1">
              {GRID.map((g) => (
                <button
                  key={g}
                  type="button"
                  title={gridLabel[g]}
                  aria-label={gridLabel[g]}
                  onClick={() => setGrid(g)}
                  className={`h-9 rounded-md border text-xs ${grid === g ? 'border-primary bg-primary/10' : 'border-input'}`}
                >
                  ●
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">
                  {s.xPercent.replace('{n}', String(xPercent))}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={xPercent}
                  onChange={(e) => setXPercent(Number(e.target.value))}
                  className="w-full"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-muted-foreground">
                  {s.yPercent.replace('{n}', String(yPercent))}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={yPercent}
                  onChange={(e) => setYPercent(Number(e.target.value))}
                  className="w-full"
                />
              </label>
            </div>
          )}
        </fieldset>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">
              {s.opacityLabel.replace('{n}', String(opacityPct))}
            </span>
            <input
              type="range"
              min={1}
              max={100}
              value={opacityPct}
              onChange={(e) => setOpacityPct(Number(e.target.value))}
              className="w-full"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">
              {s.rotationLabel.replace('{n}', String(rotation))}
            </span>
            <input
              type="range"
              min={-180}
              max={180}
              value={rotation}
              onChange={(e) => setRotation(Number(e.target.value))}
              className="w-full"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={tile}
            onChange={(e) => setTile(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          {s.tileLabel}
        </label>

        {files[0] && (
          <div className="space-y-1">
            <span className="block text-xs uppercase tracking-wide text-muted-foreground">
              {s.livePreview}
            </span>
            <p className="text-xs text-muted-foreground">{s.previewHint}</p>
            <div className="flex min-h-40 items-center justify-center overflow-hidden rounded border bg-muted p-2">
              {previewUrl ? (
                <img src={previewUrl} alt={s.livePreview} className="max-h-72 max-w-full" />
              ) : (
                <span className="text-xs text-muted-foreground">{previewError ?? '…'}</span>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">{s.outputFormat}</span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as WatermarkOptions['format'])}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="original">{s.formatOriginal}</option>
              <option value="webp">WEBP</option>
              <option value="jpeg">JPEG</option>
              <option value="png">PNG</option>
            </select>
          </label>
          {format === 'jpeg' || format === 'webp' ? (
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">
                {s.quality.replace('{n}', String(Math.round(quality * 100)))}
              </span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="w-full"
              />
            </label>
          ) : null}
        </div>

        <button
          type="button"
          onClick={run}
          disabled={!canRun || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy
            ? progress
              ? s.watermarkingProgress
                  .replace('{done}', String(progress.done))
                  .replace('{total}', String(progress.total))
              : s.watermarking
            : runLabel}
        </button>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {failures.length > 0 && (
          <output className="block space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            {failures.map((f) => (
              <p key={f.name}>{returnedErrorText(errorStrings, f.code, f.params, f.message)}</p>
            ))}
          </output>
        )}

        {results.length > 0 && (
          <div className="space-y-3">
            {results.length > 1 && (
              <button
                type="button"
                onClick={downloadAll}
                className="inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
              >
                {s.downloadAllZip.replace('{n}', String(results.length))}
              </button>
            )}
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {results.map((r, i) => (
                <li key={r.name} className="space-y-1 rounded-md border p-2">
                  <img src={previews[i]} alt={r.name} className="w-full rounded border" />
                  <p className="truncate text-sm">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.width} × {r.height} px · {kb(r.sizeBefore)} → {kb(r.sizeAfter)}
                  </p>
                  <button
                    type="button"
                    onClick={() => saveBlob(r.blob, r.name)}
                    className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"
                  >
                    {ui.download}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <PrivacyNote />
      </CardContent>
    </Card>
  );
}
