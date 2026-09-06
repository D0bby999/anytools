'use client';
import { trackEvent } from '@anytools/analytics';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PrivacyNote,
  useLocalized,
  useUiStrings,
} from '@anytools/ui';
import { useMemo, useState } from 'react';
import type { OutputFormat } from '../shared/canvas-image';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { SHARED_ERROR_STRINGS, returnedErrorText } from '../shared/shared-error-strings';
import { toolErrorText } from '../shared/tool-error';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  type FormatChoice,
  type RotateAngle,
  type RotateFailure,
  type RotateResult,
  rotateImages,
  zipRotated,
} from './logic';
import { STRINGS } from './strings';

const SLUG = 'rotate-image';
const kb = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;

export function RotateImageUi() {
  const s = useLocalized(STRINGS);
  const sharedErrors = useLocalized(SHARED_ERROR_STRINGS);
  const errorStrings = useMemo(() => ({ ...sharedErrors, ...s }), [sharedErrors, s]);
  const ui = useUiStrings();
  // Revokes every preview and download URL when the component unmounts.
  const objectUrls = useObjectUrls();

  const [files, setFiles] = useState<File[]>([]);
  const [rotate, setRotate] = useState<RotateAngle>(0);
  const [flipHorizontal, setFlipHorizontal] = useState(false);
  const [flipVertical, setFlipVertical] = useState(false);
  const [format, setFormat] = useState<FormatChoice>('original');
  const [quality, setQuality] = useState(0.92);
  const [results, setResults] = useState<RotateResult[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [befores, setBefores] = useState<string[]>([]);
  const [failures, setFailures] = useState<RotateFailure[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A "before" thumbnail for the live preview — this is a plain file reference, no decode, so
  // it costs nothing to create per render and does not need caching.
  const [liveUrl, setLiveUrl] = useState<string | null>(null);

  const reset = () => {
    objectUrls.revokeAll();
    setResults([]);
    setPreviews([]);
    setBefores([]);
    setFailures([]);
    setError(null);
    setProgress(null);
  };

  const onFilesChange = (f: File[]) => {
    setFiles(f);
    reset();
    setLiveUrl((prev) => {
      if (prev) objectUrls.revoke(prev);
      return f[0] ? objectUrls.create(f[0]) : null;
    });
  };

  const flipLabel =
    flipHorizontal && flipVertical
      ? s.flipBoth
      : flipHorizontal
        ? s.flipH
        : flipVertical
          ? s.flipV
          : s.flipNone;

  const run = async () => {
    if (files.length === 0) return;
    reset();
    setBusy(true);
    trackEvent('tool_run', { tool: SLUG });
    try {
      const outcome = await rotateImages(
        files,
        { rotate, flipHorizontal, flipVertical, format, quality },
        (done, total) => setProgress({ done, total }),
      );
      setResults(outcome.results);
      setPreviews(outcome.results.map((r) => objectUrls.create(r.blob)));
      // Indexed by `sourceIndex`, not by position in `results` — a failed file earlier in the
      // batch would otherwise shift every later result onto the wrong original thumbnail.
      setBefores(outcome.results.map((r) => objectUrls.create(files[r.sourceIndex] as File)));
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
    // Revoking in the same tick cancels the download the click just started.
    setTimeout(() => objectUrls.revoke(url), 30_000);
  };

  const downloadAll = async () => {
    setError(null);
    try {
      saveBlob(await zipRotated(results), 'rotated-images.zip');
    } catch (e) {
      setError(toolErrorText(e, errorStrings, s.zipFailed));
    }
  };

  // NOT a width/height comparison: a 90°/270° rotation legitimately swaps those two numbers on
  // every file, which would flag the whole batch as "scaled down" even when nothing shrank.
  const scaled = results.filter((r) => r.scaledDown);
  const rotateLabel =
    files.length > 1 ? s.rotateMany.replace('{n}', String(files.length)) : s.rotateOne;

  // CSS-only live preview: rotation/flip are exactly representable as a transform, so the
  // "after" thumbnail updates instantly on every button press with zero decode — the real
  // pixel export (EXIF, canvas ceiling, JPEG-on-alpha) only runs once the user clicks Rotate.
  const previewTransform = `rotate(${rotate}deg) scaleX(${flipHorizontal ? -1 : 1}) scaleY(${flipVertical ? -1 : 1})`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{s.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <MultiFileDropzone
          files={files}
          onChange={onFilesChange}
          accept="image/*"
          multiple
          label={s.dropLabel}
        />

        {liveUrl && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                {s.before}
              </span>
              <div className="flex h-40 items-center justify-center overflow-hidden rounded border bg-muted">
                <img src={liveUrl} alt={s.before} className="max-h-full max-w-full" />
              </div>
            </div>
            <div className="space-y-1">
              <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                {s.afterPreview}
              </span>
              <div className="flex h-40 items-center justify-center overflow-hidden rounded border bg-muted">
                <img
                  src={liveUrl}
                  alt={s.afterPreview}
                  style={{ transform: previewTransform }}
                  className="max-h-32 max-w-32"
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setRotate((r) => ((r + 270) % 360) as RotateAngle)}
            className="h-9 rounded-md border border-input px-3 text-sm"
          >
            {s.rotateLeft}
          </button>
          <button
            type="button"
            onClick={() => setRotate((r) => ((r + 90) % 360) as RotateAngle)}
            className="h-9 rounded-md border border-input px-3 text-sm"
          >
            {s.rotateRight}
          </button>
          <button
            type="button"
            onClick={() => setRotate((r) => ((r + 180) % 360) as RotateAngle)}
            className="h-9 rounded-md border border-input px-3 text-sm"
          >
            {s.rotate180}
          </button>
          <button
            type="button"
            onClick={() => setFlipHorizontal((v) => !v)}
            className={`h-9 rounded-md border px-3 text-sm ${flipHorizontal ? 'border-primary bg-primary/10' : 'border-input'}`}
          >
            {s.flipHorizontal}
          </button>
          <button
            type="button"
            onClick={() => setFlipVertical((v) => !v)}
            className={`h-9 rounded-md border px-3 text-sm ${flipVertical ? 'border-primary bg-primary/10' : 'border-input'}`}
          >
            {s.flipVertical}
          </button>
          <button
            type="button"
            onClick={() => {
              setRotate(0);
              setFlipHorizontal(false);
              setFlipVertical(false);
            }}
            className="h-9 rounded-md border border-input px-3 text-sm"
          >
            {ui.reset}
          </button>
        </div>
        <p className="text-sm text-muted-foreground">
          {s.currentState.replace('{rotate}', String(rotate)).replace('{flip}', flipLabel)}
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">{s.outputFormat}</span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as FormatChoice)}
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
          disabled={files.length === 0 || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy
            ? progress
              ? s.rotatingProgress
                  .replace('{done}', String(progress.done))
                  .replace('{total}', String(progress.total))
              : s.rotating
            : rotateLabel}
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

        {scaled.length > 0 && (
          <output className="block rounded-md border bg-muted px-3 py-2 text-sm">
            {(scaled.length === 1 ? s.scaledOne : s.scaledMany).replace(
              '{n}',
              String(scaled.length),
            )}
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
                  <div className="grid grid-cols-2 gap-1">
                    <img src={befores[i]} alt={s.before} className="w-full rounded border" />
                    <img src={previews[i]} alt={r.name} className="w-full rounded border" />
                  </div>
                  <p className="truncate text-sm">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.widthBefore} × {r.heightBefore} → {r.width} × {r.height} px
                    {r.scaledDown &&
                      ` ${s.scaledFrom
                        .replace('{w}', String(r.widthBefore))
                        .replace('{h}', String(r.heightBefore))}`}{' '}
                    · {kb(r.sizeBefore)} → {kb(r.sizeAfter)}
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
