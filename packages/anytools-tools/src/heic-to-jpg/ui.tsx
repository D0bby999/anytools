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
import { useState } from 'react';
import { MultiFileDropzone } from '../shared/multi-file-dropzone';
import { useObjectUrls } from '../shared/use-object-urls';
import {
  HEIC_EXTENSIONS,
  type HeicConversion,
  type HeicFailure,
  type HeicFormat,
  convertHeicFiles,
  zipConversions,
} from './logic';
import { STRINGS } from './strings';

const SLUG = 'heic-to-jpg';
const kb = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;

export function HeicToJpgUi() {
  const s = useLocalized(STRINGS);
  const ui = useUiStrings();
  // Revokes every preview and download URL when the component unmounts.
  const objectUrls = useObjectUrls();
  const [files, setFiles] = useState<File[]>([]);
  const [format, setFormat] = useState<HeicFormat>('jpeg');
  const [quality, setQuality] = useState(0.9);
  const [results, setResults] = useState<HeicConversion[]>([]);
  // Created once per batch, not in render: `createObjectURL` in JSX mints a new URL on every
  // re-render — every slider nudge would strand another full-size image in memory.
  const [previews, setPreviews] = useState<string[]>([]);
  const [failures, setFailures] = useState<HeicFailure[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      const outcome = await convertHeicFiles(files, { format, quality }, (done, total) =>
        setProgress({ done, total }),
      );
      setResults(outcome.results);
      setPreviews(outcome.results.map((r) => objectUrls.create(r.blob)));
      setFailures(outcome.failures);
    } catch (e) {
      setError(e instanceof Error ? e.message : ui.conversionFailed);
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
      saveBlob(
        await zipConversions(results),
        `heic-converted-${format === 'jpeg' ? 'jpg' : 'png'}.zip`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : s.zipFailed);
    }
  };

  const burst = results.filter((r) => r.imageCount > 1);
  // A photo above the canvas ceiling is written smaller rather than refused, so say so: the
  // download is not the size the camera took, and nothing else on the page would reveal that.
  const scaled = results.filter((r) => r.width !== r.sourceWidth || r.height !== r.sourceHeight);

  const convertLabel =
    files.length > 1 ? s.convertMany.replace('{n}', String(files.length)) : s.convertOne;

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
          // AVIF is in the list so that dropping one produces the explanation in `logic.ts`
          // rather than nothing at all: the dropzone discards anything outside `accept`
          // silently, and "my file vanished" is a worse answer than "AVIF is not supported
          // here". Nothing is decoded — the brand check turns it away before the WASM loads.
          accept={`${HEIC_EXTENSIONS.join(',')},.avif,image/heic,image/heif,image/avif`}
          multiple
          label={s.dropLabel}
        />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">{s.saveAs}</span>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as HeicFormat)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="jpeg">{s.jpgOption}</option>
              <option value="png">{s.pngOption}</option>
            </select>
          </label>

          {format === 'jpeg' && (
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
          )}
        </div>

        <button
          type="button"
          onClick={run}
          disabled={files.length === 0 || busy}
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
        >
          {busy
            ? progress
              ? s.convertingProgress
                  .replace('{done}', String(progress.done))
                  .replace('{total}', String(progress.total))
              : s.converting
            : convertLabel}
        </button>

        <p className="text-sm text-muted-foreground">{s.decoderNote}</p>

        {error && (
          <output className="block rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </output>
        )}

        {failures.length > 0 && (
          <output className="block space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            {failures.map((f) => (
              <p key={f.name}>{f.message}</p>
            ))}
          </output>
        )}

        {burst.length > 0 && (
          <output className="block rounded-md border bg-muted px-3 py-2 text-sm">
            {burst.length === 1 ? s.burstOne : s.burstMany.replace('{n}', String(burst.length))}
          </output>
        )}

        {scaled.length > 0 && (
          <output className="block rounded-md border bg-muted px-3 py-2 text-sm">
            {(scaled.length === 1 ? s.scaledOne : s.scaledMany)
              .replace('{n}', String(scaled.length))
              .replace('{sw}', String(scaled[0]?.sourceWidth))
              .replace('{sh}', String(scaled[0]?.sourceHeight))
              .replace('{w}', String(scaled[0]?.width))
              .replace('{h}', String(scaled[0]?.height))}
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
                // Output names are made unique per batch, so two IMG_0001.HEIC are two keys.
                <li key={r.name} className="space-y-1 rounded-md border p-2">
                  {/* A plain <img>: the source is a blob URL in this tab, which next/image cannot
                      optimise and must not try to fetch. */}
                  <img src={previews[i]} alt={r.name} className="w-full rounded border" />
                  <p className="truncate text-sm">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.width} × {r.height} px
                    {(r.width !== r.sourceWidth || r.height !== r.sourceHeight) &&
                      ` ${s.scaledFrom
                        .replace('{w}', String(r.sourceWidth))
                        .replace('{h}', String(r.sourceHeight))}`}{' '}
                    · {kb(r.sourceSize)} → {kb(r.blob.size)}
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
